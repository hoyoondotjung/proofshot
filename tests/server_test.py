import base64
import hashlib
import http.client
import json
import tempfile
import threading
import unittest
import server

class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.server=server.make_server(0,self.tmp.name)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        raw=b'test-image';self.record={'v':3,'img':'data:image/png;base64,'+base64.b64encode(raw).decode(),'h':hashlib.sha256(raw).hexdigest(),'iso':'2026-10-27T12:00:00Z','d':'Synthetic test'}
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def request(self,method,path,body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        data=json.dumps(body).encode() if body is not None else None
        connection.request(method,path,data,{'Content-Type':'application/json',**(headers or {})})
        response=connection.getresponse();payload=response.read();status=response.status;connection.close()
        return status,json.loads(payload) if payload else None
    def test_original_roundtrip_and_token_protected_attachment(self):
        status,created=self.request('POST','/p',self.record);self.assertEqual(status,201)
        status,read=self.request('GET','/p/'+created['id']);self.assertEqual(read,self.record);self.assertNotIn('editToken',read)
        ots=server.MAGIC+bytes([1,8])+bytes.fromhex(self.record['h'])+bytes.fromhex('000588960d73d719010101')
        body={'ots':base64.urlsafe_b64encode(ots).decode().rstrip('=')}
        path='/p/'+created['id']+'/ots'
        self.assertEqual(self.request('PUT',path,body)[0],403)
        self.assertEqual(self.request('PUT',path,body,{'Authorization':'Bearer '+created['editToken']})[0],200)
        self.assertEqual(self.request('GET','/p/'+created['id'])[1]['ots'],body['ots'])
    def test_reject_missing_or_tampered_original(self):
        bad=dict(self.record);bad.pop('img');self.assertEqual(self.request('POST','/p',bad)[0],400)
        bad=dict(self.record,h='0'*64);self.assertEqual(self.request('POST','/p',bad)[0],400)
    def test_source_and_database_are_not_public(self):
        for path in ['/server.py','/.git/config','/.proofshot-data/proofs.sqlite3','/tests/server_test.py','/assets/../server.py']:
            self.assertEqual(self.request('GET',path)[0],404)
    def test_cross_origin_writes_and_bad_hosts_rejected(self):
        self.assertEqual(self.request('POST','/p',self.record,{'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.request('GET','/',headers={'Host':'evil.example'})[0],403)

if __name__=='__main__':unittest.main()
