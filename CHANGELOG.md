# Changelog

Each release is on [GitHub Releases](https://github.com/brunoaclopes/nitido/releases), with the app as a
zip for any static host and the Docker image `ghcr.io/brunoaclopes/nitido:<version>`.

## 1.2.0 — 2026-10-09

The first release. Everything runs in your browser, and no photo leaves your device.

### Culling
- Focus is measured at 100% on the eyes, the AF point or the subject, with a sharpness map of the whole frame.
- Similar shots are grouped and the best of each group is picked.
- Culling mode goes one group at a time, and lines up each face across the burst.
- Closed eyes, motion blur, missed focus and exposure are judged the way a photographer would. The camera's own warnings are named.
- Calibration fits the sharpness limit to your eye. A personal model learns from your decisions across shoots.
- Fujifilm film recipes are shown in the loupe, with a filter for each film simulation.
- Four AI tiers, from Light (MobileCLIP S0) to Max (SigLIP 2), with one suggested for your computer.

### Finishing a shoot
- Finish copies the keepers to your NAS with their RAF, checking every copy, and sets the rejects aside. Safari and Firefox get a script that does the same.
- XMP sidecars, a CSV table and a JSON report.

### Privacy
- No server, no upload, no account, no tracking.
- A Content-Security-Policy lets the page connect only to its own site, the library CDN and the model hosts.
- The browser test fails if a session sends anything.
- The font ships with the app.

### Everywhere
- Phones and tablets: touch gestures, always-visible selection, and a Finish that hands the decisions to a computer.
- Installs as an app (computer, iPhone, iPad, Android) and works offline once the models are cached.
- Survives a refresh: Chrome and Edge reopen the folder by themselves, on the same photo.
- Your profile (settings and personal model) saves to a file. A shoot's decisions load on another device.
- Themes: Dark, Light and Liquid glass. Languages: English and Portuguese.

### Self-hosting
- A Docker image (amd64, arm64) with every AI model and library inside, so the page makes no request outside your server.
- Profiles and each shoot's decisions are kept on the server and follow you from browser to browser.
- `NITIDO_*` variables set the defaults for new browsers. `PUID`/`PGID` set the owner of `/data`.
- The compose file has an optional Caddy service for HTTPS on your network.
