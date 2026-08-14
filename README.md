# ProofShot

Public-facing ProofShot website and browser demo, archived from the deployed site at <https://proofshotglobal.pages.dev/>.

ProofShot is real-item authentication infrastructure for secondhand trade. It combines live capture, SHA-256 file hashing, public verification links, and Bitcoin timestamp anchoring through OpenTimestamps.

## Files

- `index.html` — product and company landing page
- `app.html` — browser-based ProofShot app experience
- `ots.js` — OpenTimestamps client logic
- `config.js` — public client configuration
- `assets/`, `icons/` — public site assets

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

## Deployment note

The deployed Cloudflare Pages site refers to a server-side `_worker.js` proof store. Server-side worker source and deployment secrets are not exposed by the public website and are therefore not included in this archive.

