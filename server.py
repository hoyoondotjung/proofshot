#!/usr/bin/env python3
"""Loopback-only development proof store. Not a production deployment server."""
import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import re
import secrets
import sqlite3
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parent
MAX_BODY = 17 * 1024 * 1024
MAGIC = bytes.fromhex('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294')
STATIC = {'index.html', 'app.html', 'verify.html', 'config.js', 'ots.js', 'proof.js', 'app.js', 'demo.js', 'verify.js', 'sw.js', 'manifest.webmanifest', 'og.png'}


def decode_ots(value, fingerprint):
    if not isinstance(value, str) or len(value) > 134000 or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError('Invalid timestamp encoding')
    try:
        raw = base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)
    except Exception as exc:
        raise ValueError('Invalid timestamp encoding') from exc
    prefix = MAGIC + bytes([1, 8]) + bytes.fromhex(fingerprint)
    if not raw.startswith(prefix) or len(raw) <= len(prefix) or len(raw) > 100000:
        raise ValueError('Timestamp fingerprint mismatch')
    # Storage validates binding/size only; browser verification validates the tree and chain.
    return value


def validate_record(body):
    fingerprint = body.get('h', '')
    if not isinstance(fingerprint, str) or not re.fullmatch(r'[0-9a-f]{64}', fingerprint):
        raise ValueError('Invalid fingerprint')
    image = body.get('img', '')
    if not isinstance(image, str):
        raise ValueError('Missing image')
    match = re.fullmatch(r'data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})', image)
    if not match:
        raise ValueError('Invalid image')
    try:
        original = base64.b64decode(match[2], validate=True)
    except Exception as exc:
        raise ValueError('Invalid image encoding') from exc
    if not original or len(original) > 12 * 1024 * 1024 or hashlib.sha256(original).hexdigest() != fingerprint:
        raise ValueError('Original fingerprint mismatch')
    iso, device = body.get('iso', ''), body.get('d', '')
    if not isinstance(iso, str) or len(iso) > 50 or not isinstance(device, str) or len(device) > 100:
        raise ValueError('Invalid reported metadata')
    record = {'v': 3, 'h': fingerprint, 'img': image, 'iso': iso, 'd': device}
    if body.get('ots'):
        record['ots'] = decode_ots(body['ots'], fingerprint)
    return record


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def allowed_host(self):
        return self.headers.get('Host', '') in {'localhost:' + str(self.server.server_port), '127.0.0.1:' + str(self.server.server_port)}

    def body(self):
        if not self.allowed_host():
            raise PermissionError('Unexpected host')
        origin = self.headers.get('Origin')
        if origin and origin not in {'http://localhost:' + str(self.server.server_port), 'http://127.0.0.1:' + str(self.server.server_port)}:
            raise PermissionError('Unexpected origin')
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise ValueError('JSON required')
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= MAX_BODY:
            raise ValueError('Request size exceeded')
        self.connection.settimeout(20)
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError('JSON object required')
        return value

    def do_GET(self):
        if not self.allowed_host():
            return self.reply(403, {'error': 'Unexpected host'})
        path = unquote(urlsplit(self.path).path)
        match = re.fullmatch(r'/p/([a-f0-9]{32})', path)
        if match:
            with sqlite3.connect(self.server.db_path) as db:
                row = db.execute('SELECT record FROM proofs WHERE id=?', (match[1],)).fetchone()
            return self.reply(200, json.loads(row[0])) if row else self.reply(404, {'error': 'Record not found'})
        relative = path.lstrip('/') or 'index.html'
        if '..' in Path(relative).parts:
            return self.reply(404, {'error': 'Not found'})
        target = (ROOT / relative).resolve()
        if ROOT not in target.parents or not target.is_file():
            return self.reply(404, {'error': 'Not found'})
        canonical = target.relative_to(ROOT).as_posix()
        if canonical not in STATIC and not canonical.startswith(('assets/', 'icons/')):
            return self.reply(404, {'error': 'Not found'})
        return super().do_HEAD() if self.command == 'HEAD' else super().do_GET()

    def do_HEAD(self):
        return self.do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != '/p':
            return self.reply(404, {'error': 'Not found'})
        try:
            record = validate_record(self.body())
            proof_id, token = secrets.token_hex(16), secrets.token_urlsafe(32)
            with sqlite3.connect(self.server.db_path) as db:
                db.execute('INSERT INTO proofs VALUES (?,?,?,?)', (proof_id, hashlib.sha256(token.encode()).hexdigest(), json.dumps(record), time.time()))
            return self.reply(201, {'id': proof_id, 'editToken': token})
        except PermissionError as exc:
            return self.reply(403, {'error': str(exc)})
        except (ValueError, KeyError, TimeoutError) as exc:
            return self.reply(400, {'error': str(exc)})

    def do_PUT(self):
        match = re.fullmatch(r'/p/([a-f0-9]{32})/ots', urlsplit(self.path).path)
        if not match:
            return self.reply(404, {'error': 'Not found'})
        try:
            body = self.body()
            token = self.headers.get('Authorization', '').removeprefix('Bearer ')
            with sqlite3.connect(self.server.db_path) as db:
                row = db.execute('SELECT record, token_hash FROM proofs WHERE id=?', (match[1],)).fetchone()
                if not row:
                    return self.reply(404, {'error': 'Record not found'})
                if not hmac.compare_digest(row[1], hashlib.sha256(token.encode()).hexdigest()):
                    return self.reply(403, {'error': 'Edit token required'})
                record = json.loads(row[0]); record['ots'] = decode_ots(body.get('ots'), record['h'])
                db.execute('UPDATE proofs SET record=? WHERE id=?', (json.dumps(record), match[1]))
            return self.reply(200, {'ok': True})
        except PermissionError as exc:
            return self.reply(403, {'error': str(exc)})
        except (ValueError, KeyError, TimeoutError) as exc:
            return self.reply(400, {'error': str(exc)})


def make_server(port=8081, data=None):
    data = Path(data or ROOT / '.proofshot-data'); data.mkdir(parents=True, exist_ok=True, mode=0o700)
    db_path = data / 'proofs.sqlite3'
    with sqlite3.connect(db_path) as db:
        db.execute('CREATE TABLE IF NOT EXISTS proofs (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, record TEXT NOT NULL, created REAL NOT NULL)')
    db_path.chmod(0o600)
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler); server.db_path = str(db_path)
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--port', type=int, default=8081); args = parser.parse_args()
    server = make_server(args.port)
    print('ProofShot local preview: http://localhost:%s (loopback only)' % server.server_port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
