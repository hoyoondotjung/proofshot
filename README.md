# ProofShot

A browser camera and file-timestamp demo, originally archived from
<https://proofshotglobal.pages.dev/>.

ProofShot stores original photo bytes, calculates their SHA-256 fingerprint,
requests an OpenTimestamps timestamp and checks the timestamp against public
Bitcoin block explorers. **It does not authenticate a physical item, ownership,
camera source, or the device-reported capture time.** A matching hash or a pending
calendar attestation is never presented as a verified Bitcoin record.

## Run locally

Python 3.9 or later is sufficient; the website does not need a frontend build.

```sh
python3 server.py --port 8081
```

Open <http://localhost:8081/?lang=ko> or <http://localhost:8081/?lang=en>.
The language button remembers your choice and internal links preserve it.

The server binds to `127.0.0.1` only and stores development records in
`.proofshot-data/proofs.sqlite3` (ignored by Git and not served over HTTP).
Links made here are for this computer; they are not public Internet links.
The server serves only the website's public files, never repository sources,
tests, dependencies, or the database.

A plain static server can still show the site and save local camera records, but
cannot create short verification links. Upload failures are shown explicitly;
there is no silent thumbnail-only sharing fallback.

## Release visibility

The public landing and verification pages currently lead only to the web demo.
ProofShot app links, installation prompts and the landing-page manifest link are
removed while the app is being prepared. The app files remain available for
development; its IndexedDB storage behavior below is not part of the public demo.

## Capture, storage and sharing

- Camera originals and available `.ots` bytes are saved in IndexedDB in this
  browser. Reopening a record preserves the original download and upload retry.
- Timestamp requests send a blinded commitment to public calendar servers.
- The **Upload photo & create link** action sends the original photo, device label
  and device-reported time to the proof store. Anyone with its link can view them.
- Deleting a record from the app deletes only its local original and record.
  It does not revoke an already shared server copy. Download a backup before
  deleting records or clearing browser data.
- The website demo hashes a JPEG copy of the loaded image. Download **that exact
  JPEG** with its `.ots` file; re-encoding or messenger compression changes the
  fingerprint. Unlike the app, the website demo is session-only.
- Old records without original bytes can recover them only when the existing
  server still holds a matching original. Lost originals cannot be reconstructed
  from a hash or thumbnail.

## Verification

The viewer independently checks three separate conditions: file bytes match the
recorded fingerprint, the `.ots` digest references that fingerprint, and the
calculated commitment matches a Bitcoin block's merkle root. Only all three
successful checks produce **File timestamp verified**. Preview-only legacy links
must be checked against the original file using the keyboard-accessible file
picker or drag and drop.

Network failures remain **unavailable**, not confirmed. A pending attestation is
only data in a file; it does not by itself establish calendar registration or
capture authenticity. The verifier contacts only the supported calendar hosts.
A successful upgrade merges the full operation paths into a standard detached
`.ots` file, persists it, and updates the shared record. This lets later checks
use the confirmed Bitcoin branch without depending on a calendar still being up.
Block explorers remain external sources; use your own Bitcoin node and the
standard OpenTimestamps client for independent chain validation.

Reference: <https://opentimestamps.org/#how-it-works> and the
[OpenTimestamps serialization implementation](https://github.com/opentimestamps/python-opentimestamps/blob/master/opentimestamps/core/timestamp.py).

## Files

- `index.html`, `demo.js`: landing page and image/camera demo
- `app.html`, `app.js`: persistent local camera records, original downloads, sharing
- `verify.html`, `verify.js`: original-file and timestamp verification
- `proof.js`: shared record validation, language, upload, clipboard and downloads
- `ots.js`: timestamp parsing, canonical tree merging, upgrading and verification
- `server.py`: loopback-only development proof store
- `sw.js`: public-shell cache; proof API responses are never cached
- `config.js`: optional separate proof-store base URL (`PS_API`)

## Tests

Use Node 22.22.2+, Node 24.15.0+, or Node 26+, and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm test
python3 -m unittest discover -s tests -p '*_test.py'
```

Tests cover malicious/unregistered pending proofs, explorer outages, merkle-root
mismatches, multi-calendar branch serialization, full-proof upgrades, original
persistence across reloads, offline sharing retry, legacy file selection, camera
cancellation, correct photo uploads, and proof-store integrity/access checks.
UI tests simulate camera frames and browser storage; they do not grant camera
access or wait for a new Bitcoin block. Live browser screenshots and any actual
calendar connectivity checks are separate from these deterministic tests.

## Production deployment

The Cloudflare Pages project `proofshot` is connected to this repository: every
push to `main` is built and published to <https://proofshot.pages.dev/>, and other
branches get preview URLs. The build command copies only the public files
(`STATIC`, `assets/` and `icons/` from `server.py`) into `_site`, the output
directory. When you add a public file, add it to `STATIC` and to the build command
in the Pages settings.

That deployment is static: it has no proof store, so short verification links are
not available there. The original site's `_worker.js` and deployment credentials
are not in this archive. `server.py` is a development adapter, not a production
backend. A production store requires HTTPS, durable storage, retention/deletion
controls, upload limits and operational protections before publishing.

Store contract (JSON, no-store responses):

- `POST /p`: `{v:3,h,img,iso,d,ots?}`; validate the original hash; returns
  `{id,editToken?}`. `img` is a JPEG/PNG/WebP data URL.
- `GET /p/:id`: returns the original record, never its edit token.
- `PUT /p/:id/ots`: `{ots}` encoded as base64url; use `Authorization: Bearer
  <editToken>` for stores supporting authenticated updates. The local server
  requires the token and checks that the `.ots` file references the same hash.

Server acceptance is storage validation, not cryptographic timestamp validation.
The viewer must perform the full verification regardless of where a record came
from. Multi-angle capture, random missions, subscriptions and SDK integrations
are explicitly marked as planned rather than implemented capabilities.
