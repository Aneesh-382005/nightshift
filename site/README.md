# site

Static companion page for Nightshift. One `index.html` with inline CSS and inline SVG: no build step, no external requests, no JavaScript. Light and dark follow the system setting (`color-scheme` and `light-dark()` tokens).

- Preview: open `index.html`, or `python3 -m http.server -d site 8000`.
- Cloudflare Pages: build command empty, output directory `site`.
- Demo video: put `demo.mp4` next to `index.html`; the page already has the `<video>` tag and a link for it.
- Copy comes from README.md, docs/DEVPOST.md and docs/PITCH.md, limited to what docs/TRACKER.md marks verified. Re-check the "real vs stand-in" and "measured numbers" tables when the tracker changes.
