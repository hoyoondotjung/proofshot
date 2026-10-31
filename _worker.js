/* ====================== ProofShot Proof Store (built into the site) ======================
   Cloudflare Pages "advanced mode" worker: /p API + static site in one deployment.
   The store is a dumb, untrusted warehouse — every integrity check that CAN be
   done client-side (SHA-256 recompute, OTS → Bitcoin merkle, ECDSA signature,
   attestation chain) runs in the buyer's browser. The worker's own checks exist
   to keep junk out of the store, not to be the thing anyone trusts.

   Setup (once, in the Cloudflare dashboard):
     Workers & Pages → proofshot → Settings → Bindings
     → Add → KV namespace → name: PROOFS → namespace: proofshot-proofs
   The Pages build copies this file into _site; pushes to main deploy it.

   API:
     POST /challenge                        -> {nonce,iat,exp,strobe}
     POST /p          {v,iso,d,h,img,...}   -> {id,level,claims}
     PUT  /p/:id/ots  {ots}                 -> {ok}
     GET  /p/:id                            -> stored record
   id = first 12 hex chars of the photo's SHA-256 (same original = same link).

   Proof format v4 contract: docs/01_증명포맷_v4.md — the signing input is a
   byte-exact contract; do not "clean up" the string building below.
========================================================================================== */

const MAX_BODY = 8 * 1024 * 1024;   // 8 MB
const HASH_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{64}$/;
const CHALLENGE_TTL_MS = 60 * 1000;         // how long a challenge stays usable
const CHALLENGE_KV_TTL = 120;               // KV minimum is 60s; leave headroom

/* Phase 0 caps the level at L1: without Apple/Google credentials the worker
   cannot prove the signing key really lives in secure hardware, and an
   unverified hardware claim must never be sold as L2/L3. Set the
   ATTESTATION_VERIFY binding to "on" once vendor verification is wired. */
const PHASE0_MAX_LEVEL = 1;

/* Challenge issuance is unauthenticated by necessity — it happens before the
   app has anything to prove. Cap it so nobody farms nonces or runs up KV
   writes. KV is eventually consistent, so this is a speed bump rather than a
   hard ceiling; a strict limit belongs in a Cloudflare Rate Limiting rule or
   a Durable Object, neither of which needs to exist for this to be useful. */
const CHALLENGE_PER_MIN = 20;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra }
  });
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return b64ToBytes(b64 + "=".repeat((4 - b64.length % 4) % 4));
}
function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(buf));
}
const enc = new TextEncoder();

/* Minimal .ots sanity check: header magic + the committed digest must equal
   the record's anchor target (layout: MAGIC(31) ver-varint(1) OP_SHA256(0x08) digest(32)).
   Note the anchor target is `anchorDigest`, which equals `h` for L0 records. */
const OTS_MAGIC = [0x00,0x4f,0x70,0x65,0x6e,0x54,0x69,0x6d,0x65,0x73,0x74,0x61,0x6d,0x70,0x73,0x00,0x00,0x50,0x72,0x6f,0x6f,0x66,0x00,0xbf,0x89,0xe2,0xe8,0x84,0xe8,0x92,0x94];
function otsMatchesHash(otsB64url, hashHex) {
  try {
    const bytes = b64urlToBytes(otsB64url);
    if (bytes.length < 66 || bytes.length > 64 * 1024) return false;
    for (let i = 0; i < 31; i++) if (bytes[i] !== OTS_MAGIC[i]) return false;
    if (bytes[31] !== 0x01 || bytes[32] !== 0x08) return false;
    let hex = "";
    for (let i = 33; i < 65; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex === hashHex;
  } catch (e) { return false; }
}

/* ---------------------------------------------------------------------------
   Proof format v4 — signing input.
   Byte-exact; the native apps build the identical string. See §4 of the spec.
--------------------------------------------------------------------------- */
function sigInputString(b) {
  return "PROOFSHOT/v4\n" +
         b.nonce      + "\n" +
         b.frameHash  + "\n" +
         b.sensorHash + "\n" +
         b.platform   + "\n" +
         b.pipeline;
}
/* Canonical sensor serialization — spec §4.1.
   Every real number is carried as an INTEGER in fixed units (×1,000,000), never
   as a formatted decimal. Decimal formatting does not agree across languages:
   JS toFixed rounds the exact binary double, Java's %.6f rounds the shortest
   decimal form, and C printf does a third thing — so `1234.5678905` produced
   three different strings and every signature built on it would have been
   rejected at random. One IEEE754 multiply plus an integer round is bit-identical
   everywhere. Do not reintroduce decimals here. */
function q(v) {
  if (v === undefined || v === null || typeof v !== "number" || !isFinite(v)) return -1;
  return (v < 0 ? -1 : 1) * Math.round(Math.abs(v) * 1e6);
}
function traceStr(a) {
  return (Array.isArray(a) ? a : [])
    .map(s => `${q(s.x)},${q(s.y)},${q(s.z)}@${Math.trunc(s.t)}`).join(";");
}
function sensorString(sn) {
  return "gyro:"      + traceStr(sn.gyro)  + "\n" +
         "accel:"     + traceStr(sn.accel) + "\n" +
         "exposure:"  + q(sn.exposure) + "\n" +
         "iso:"       + Math.trunc(sn.iso || 0) + "\n" +
         "focus:"     + q(sn.focus) + "\n" +
         "lux:"       + q(sn.lux) + "\n" +
         "lens:"      + String(sn.lens || "") + "\n" +
         "monotonic:" + Math.trunc(sn.monotonic || 0) + "\n" +
         "wall:"      + Math.trunc(sn.wall || 0);
}

function bundleString(sigInput, sigB64url, keyPubB64url) {
  return "PROOFSHOT-BUNDLE/v4\n" + sigInput + "\n" + sigB64url + "\n" + keyPubB64url;
}

/* Verify the hardware key's signature over the signing input.
   P-256 / SHA-256, signature in IEEE P1363 (r‖s, 64 bytes) — not DER. */
async function verifyBundleSignature(bundle, frameHash) {
  let keyBytes, sigBytes;
  try {
    keyBytes = b64urlToBytes(bundle.keyPub);
    sigBytes = b64urlToBytes(bundle.sig);
  } catch (e) { return { ok: false, reason: "bad_key" }; }

  if (sigBytes.length !== 64) return { ok: false, reason: "bad_signature" };

  let key;
  try {
    key = await crypto.subtle.importKey(
      "spki", keyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch (e) { return { ok: false, reason: "bad_key" }; }

  const input = sigInputString({
    nonce: bundle.nonce, frameHash,
    sensorHash: bundle.sensorHash, platform: bundle.platform, pipeline: bundle.pipeline
  });

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, sigBytes, enc.encode(input));
  } catch (e) { return { ok: false, reason: "bad_signature" }; }

  return ok ? { ok: true, sigInput: input } : { ok: false, reason: "bad_signature" };
}

/* Structural validation only — no vendor round-trip. Returns what we can honestly say. */
function attestationShape(att) {
  if (!att || typeof att !== "object") return "absent";
  if (att.type === "app-attest")      return typeof att.object === "string" && att.object.length > 32 ? "pending" : "failed";
  if (att.type === "key-attestation") return Array.isArray(att.chain) && att.chain.length >= 2 ? "pending" : "failed";
  if (att.type === "play-integrity")  return typeof att.token === "string" && att.token.length > 32 ? "pending" : "failed";
  return "failed";
}

/* Liveness: the app reports per-signal scores; the server decides.
   Any single strong signal is not enough — a flat-surface call needs agreement. */
function livenessVerdict(l) {
  if (!l || typeof l !== "object") return { state: "absent", score: null };
  const vals = ["parallax", "illum", "moire", "depth"]
    .map(k => (typeof l[k] === "number" && l[k] >= 0 && l[k] <= 1) ? l[k] : null)
    .filter(v => v !== null);
  if (!vals.length) return { state: "absent", score: null };
  const score = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (vals.length >= 2 && score >= 0.75) return { state: "verified", score };
  return { state: "weak", score };
}

/* Level is derived from claims, never asserted by the client. */
function deriveLevel(claims, maxLevel) {
  let lvl = 0;
  if (claims.challengeFresh === "verified" &&
      claims.signatureValid === "verified" &&
      (claims.hardwareBacked === "verified" || claims.hardwareBacked === "pending")) lvl = 1;
  if (lvl === 1 && claims.hardwareBacked === "verified" &&
      claims.directPipeline === "claimed" && claims.sensorMatches === "verified") lvl = 2;
  if (lvl === 2 && claims.notFlat === "verified") lvl = 3;
  return Math.min(lvl, maxLevel);
}


/* ---------------------------------------------------------------------------
   OpenTimestamps stamping, server side.

   Nobody else does this. The web app stamps in the browser, but a native app
   would have to port an OTS client to Kotlin and again to Swift — and until it
   did, every app-captured proof would sit at existedBefore:"pending" forever
   with no Bitcoin anchor at all. Doing it here covers every client at once.

   This does not weaken the trust model: the .ots is self-verifying against
   Bitcoin block headers, so it does not matter who submitted the digest. The
   worker cannot forge an earlier time, and if it never stamps, the buyer's
   page says "pending" honestly.
--------------------------------------------------------------------------- */
const OTS_CALENDARS = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
  "https://a.pool.eternitywall.com",
  "https://ots.btc.catallaxy.com"
];

function otsConcat(...parts) {
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let pos = 0; for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}
function otsVarint(n) {
  if (n === 0) return new Uint8Array([0]);
  const out = [];
  while (n > 0) { let b = n & 0x7f; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); }
  return new Uint8Array(out);
}
function otsVarbytes(b) { return otsConcat(otsVarint(b.length), b); }
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToB64url(b) {
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Submit `digestHex` to the calendars and assemble a standard detached .ots. */
async function otsStamp(digestHex) {
  const digest = hexToBytes(digestHex);
  /* Blind the commitment before it leaves us, exactly as the browser client
     does: the calendars learn a random-looking hash, not the anchor digest. */
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const commitBuf = await crypto.subtle.digest("SHA-256", otsConcat(digest, nonce));
  const commitment = new Uint8Array(commitBuf);
  const commitHex = bytesToHex(commitment);

  const replies = await Promise.allSettled(OTS_CALENDARS.map(async cal => {
    const res = await fetch(cal + "/digest", {
      method: "POST",
      headers: {
        "Accept": "application/vnd.opentimestamps.v1",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: commitHex,
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) throw new Error("calendar " + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 10 || bytes.length > 10000) throw new Error("calendar: bad reply");
    return bytes;
  }));

  const good = replies.filter(r => r.status === "fulfilled").map(r => r.value);
  if (!good.length) throw new Error("no calendar reachable");

  const parts = [
    new Uint8Array(OTS_MAGIC), otsVarint(1), new Uint8Array([0x08]), digest,
    new Uint8Array([0xf0]), otsVarbytes(nonce), new Uint8Array([0x08])
  ];
  /* Children of one node: every one but the last carries a 0xff separator. */
  for (let i = 0; i < good.length; i++) {
    if (i < good.length - 1) parts.push(new Uint8Array([0xff]));
    parts.push(good[i]);
  }
  return bytesToB64url(otsConcat(...parts));
}

/** Stamp in the background and attach. Never let this fail a capture. */
async function stampAndAttach(env, id, anchorDigest) {
  try {
    const ots = await otsStamp(anchorDigest);
    if (!otsMatchesHash(ots, anchorDigest)) return;      // paranoia: never store a mismatched seal
    const key = "p:" + id;
    const raw = await env.PROOFS.get(key);
    if (!raw) return;
    const rec = JSON.parse(raw);
    if (rec.ots) return;                                  // a client beat us to it
    /* The record we just re-read must still be the one we stamped. Attaching a
       seal that commits to some other digest would produce a proof that fails
       verification in the buyer's browser — worse than having no seal at all. */
    if ((rec.anchorDigest || rec.h) !== anchorDigest) return;
    rec.ots = ots;
    await env.PROOFS.put(key, JSON.stringify(rec));
  } catch (e) {
    /* Swallowed on purpose. The record stays sealed and verifiable; the buyer's
       page simply shows the anchor as still pending, which is the truth. */
  }
}

/* ---------------------------------------------------------------------------
   Routes
--------------------------------------------------------------------------- */
async function rateLimited(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "anon";
  const bucket = Math.floor(Date.now() / 60000);
  const key = `rl:${ip}:${bucket}`;
  const n = Number(await env.PROOFS.get(key) || 0);
  if (n >= CHALLENGE_PER_MIN) return true;
  await env.PROOFS.put(key, String(n + 1), { expirationTtl: 120 });
  return false;
}

async function handleApi(req, env, url, ctx) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!env.PROOFS) return json({ error: "kv_not_bound", hint: "Add KV binding PROOFS in Pages settings" }, 500);

  /* POST /challenge — a capture-time nonce. Single use, 60s. Without this an
     attestation captured once could be replayed onto any photo forever. */
  if (url.pathname === "/challenge" && req.method === "POST") {
    if (await rateLimited(req, env)) return json({ error: "rate_limited" }, 429);
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonce = bytesToHex(nonceBytes);
    const iat = Date.now();
    /* strobe pattern is derived from the nonce, so it cannot be pre-rendered */
    const strobe = [...nonceBytes.slice(0, 8)].map(b => b & 1);
    await env.PROOFS.put("n:" + nonce, String(iat), { expirationTtl: CHALLENGE_KV_TTL });
    return json({ nonce, iat, exp: iat + CHALLENGE_TTL_MS, strobe }, 201, { "Cache-Control": "no-store" });
  }

  /* GET /p/:id — don't cache until the .ots seal is attached, so buyers
     never see a stale "not sealed yet" record */
  let m = url.pathname.match(/^\/p\/([0-9a-f]{12})$/);
  if (m && req.method === "GET") {
    const rec = await env.PROOFS.get("p:" + m[1]);
    if (!rec) return json({ error: "not_found" }, 404);
    const parsed = JSON.parse(rec);
    const cache = parsed.ots ? "public, max-age=300" : "no-store";
    return json(parsed, 200, { "Cache-Control": cache });
  }

  /* PUT /p/:id/ots — attach (or upgrade) the Bitcoin proof. The digest is
     checked against the record's anchor target, which is the bundle hash for
     v4 records and the photo hash for v3/L0 ones. */
  m = url.pathname.match(/^\/p\/([0-9a-f]{12})\/ots$/);
  if (m && req.method === "PUT") {
    const raw = await req.text();
    if (raw.length > 128 * 1024) return json({ error: "too_large" }, 413);
    let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: "bad_json" }, 400); }
    if (typeof body.ots !== "string") return json({ error: "missing_ots" }, 400);
    const key = "p:" + m[1];
    const stored = await env.PROOFS.get(key);
    if (!stored) return json({ error: "not_found" }, 404);
    const rec = JSON.parse(stored);
    if (!otsMatchesHash(body.ots, rec.anchorDigest || rec.h)) return json({ error: "ots_digest_mismatch" }, 400);
    rec.ots = body.ots;
    await env.PROOFS.put(key, JSON.stringify(rec));
    return json({ ok: true });
  }

  /* POST /p */
  if (url.pathname === "/p" && req.method === "POST") {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "too_large" }, 413);
    let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: "bad_json" }, 400); }

    const { iso, d, h, img, ots, bundle } = body;
    if (!HASH_RE.test(h || "")) return json({ error: "bad_hash" }, 400);
    if (typeof img !== "string" || !img.startsWith("data:image/jpeg;base64,"))
      return json({ error: "bad_image" }, 400);
    if (typeof iso !== "string" || isNaN(Date.parse(iso))) return json({ error: "bad_time" }, 400);

    /* server-side gate: the stored image must actually BE the hashed original */
    const bytes = b64ToBytes(img.slice("data:image/jpeg;base64,".length));
    const digest = await sha256Hex(bytes);
    if (digest !== h) return json({ error: "hash_mismatch" }, 400);

    const id = h.slice(0, 12);
    const key = "p:" + id;

    /* Byte-identical photo already stored. Answer from the existing record and
       leave the caller's challenge unspent — burning it here would cost them a
       capture for nothing. (A real camera never yields identical frames twice;
       this is the re-submit path, e.g. a retried upload.) */
    const existing = await env.PROOFS.get(key);
    if (existing) {
      const prev = JSON.parse(existing);
      if (prev.h !== h) return json({ error: "id_collision" }, 409);
      if (!prev.ots && typeof ots === "string" &&
          otsMatchesHash(ots, prev.anchorDigest || prev.h)) {
        prev.ots = ots;
        await env.PROOFS.put(key, JSON.stringify(prev));
      }
      return json({ id, level: prev.level || 0, claims: prev.claims || null, duplicate: true });
    }

    /* ---- claims start at the honest floor ---- */
    const claims = {
      bytesUnchanged: "verified",      // the buyer re-checks this themselves
      existedBefore:  ots ? "verified" : "pending",
      challengeFresh: "absent",
      signatureValid: "absent",
      hardwareBacked: "absent",
      genuineApp:     "absent",
      directPipeline: "absent",
      sensorMatches:  "absent",
      notFlat:        "absent"
    };
    let anchorDigest = h;
    let storedBundle = null;

    /* ---- v4 attestation bundle (optional; absent = L0, same as v3) ---- */
    if (bundle && typeof bundle === "object") {
      if (!NONCE_RE.test(bundle.nonce || "") ||
          !HASH_RE.test(bundle.sensorHash || "") ||
          typeof bundle.keyPub !== "string" || typeof bundle.sig !== "string" ||
          (bundle.platform !== "ios" && bundle.platform !== "android") ||
          (bundle.pipeline !== "direct" && bundle.pipeline !== "unknown"))
        return json({ error: "bad_bundle" }, 400);

      /* burn the challenge: present, unexpired, and not already used */
      const nKey = "n:" + bundle.nonce;
      const issued = await env.PROOFS.get(nKey);
      if (!issued || Date.now() - Number(issued) > CHALLENGE_TTL_MS)
        return json({ error: "stale_challenge" }, 400);
      await env.PROOFS.delete(nKey);
      claims.challengeFresh = "verified";

      const sigRes = await verifyBundleSignature(bundle, h);
      if (!sigRes.ok) return json({ error: sigRes.reason }, 400);
      claims.signatureValid = "verified";

      /* The signature covers sensorHash, not the sensor payload. Recompute the
         hash from the payload so a record can never carry sensor data that
         disagrees with what was signed. Loud failure beats a silent mismatch
         the buyer's browser would catch later. */
      if (bundle.sensor && typeof bundle.sensor === "object") {
        const reHash = await sha256Hex(enc.encode(sensorString(bundle.sensor)));
        if (reHash !== String(bundle.sensorHash).toLowerCase())
          return json({ error: "sensor_mismatch" }, 400);
        claims.sensorMatches = "verified";
      }
      claims.directPipeline = bundle.pipeline === "direct" ? "claimed" : "absent";
      claims.hardwareBacked = attestationShape(bundle.att);
      claims.genuineApp     = claims.hardwareBacked === "pending" ? "pending" : claims.hardwareBacked;

      /* Liveness scores are self-reported by the app. A tampered build can
         put 0.99 in every field, so the numbers mean nothing until we know
         the app itself is genuine — never surface them as verified first. */
      const live = livenessVerdict(bundle.liveness);
      claims.notFlat = (live.state === "verified" && claims.hardwareBacked !== "verified")
        ? "weak" : live.state;

      anchorDigest = await sha256Hex(enc.encode(
        bundleString(sigRes.sigInput, bundle.sig, bundle.keyPub)));
      storedBundle = bundle;
    }

    if (ots !== undefined && ots !== null &&
        (typeof ots !== "string" || !otsMatchesHash(ots, anchorDigest)))
      return json({ error: "ots_digest_mismatch" }, 400);

    const maxLevel = (env.ATTESTATION_VERIFY === "on") ? 3 : PHASE0_MAX_LEVEL;
    const level = deriveLevel(claims, maxLevel);

    const rec = {
      v: 4, iso, d: String(d || "").slice(0, 60), h, img,
      anchorDigest, ots: ots || null,
      bundle: storedBundle, level, claims, up: Date.now()
    };
    await env.PROOFS.put(key, JSON.stringify(rec));
    /* Anchor in the background — the capture must not wait on calendar servers. */
    if (!rec.ots) ctx?.waitUntil?.(stampAndAttach(env, id, anchorDigest));
    return json({ id, level, claims }, 201);
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/p" || url.pathname.startsWith("/p/") || url.pathname === "/challenge")
      return handleApi(req, env, url, ctx);
    return env.ASSETS.fetch(req);   // everything else = the static site
  }
};
