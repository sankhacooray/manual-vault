# Manual Vault: notes for Claude

See README.md for what the app does and the repo layout. This file holds what
isn't obvious from the code.

## Deploying

- **Public site (`docs/`)**: GitHub Pages serves `main:/docs` at
  manuals.sankhacooray.com. Pushing to `main` is the deploy (live in ~20 s).
- **Apps Script (`appscript/src/`)**: `cd appscript && npm run deploy`. It pushes
  with clasp user `bsc2fast` (credentials in `~/.clasprc.json`) and redeploys
  the fixed deployment ID, so the `/exec` URL never changes. Pushing to git
  does not update the web app.
- After a deploy, curl every page and image on the live site for 200s and the
  right content types.

## Things that bite

- The `/exec` URL is hard-coded in four places: `docs/signin.html` (Google
  button + account chooser link), `docs/scan.html` (`APP_URL`),
  `appscript/src/Index.html` (`APP_URL`) and `appscript/deploy.js`. Change all
  of them together.
- Apps Script serves the app in an iframe with no camera permission. Scanning
  opens `docs/scan.html` as a top-level tab, which posts the result back with
  `postMessage` (origin `https://manuals.sankhacooray.com`).
- Every page scrolls inside `<body>`, with `html { overflow: hidden }` so there's
  no overscroll bounce. The browser's own `#hash` jump scrolls `<html>` instead,
  so `assets/site.js` resets it and scrolls the body (`toHash`). Use
  `document.body.scrollTo`, never `window.scrollTo`.
- Inline SVG drop shadows get clipped at the SVG's edges unless the SVG has
  `overflow: visible`.

## UI

- Built to the user's `ui-ux-style` skill: screen-fit landing sections, a
  floating app bar with one CTA, light and dark themes (`localStorage` key
  `sc-theme`), no divider lines, no tallies, a one-line footer with a ⓘ note.
- Shared CSS and JS for the public pages: `docs/assets/site.css` and
  `docs/assets/site.js`. Bump the `?v=` on their links when they change.
- The app (`Index.html`) carries its own copy of the same tokens, because Apps
  Script can't load files from `docs/`. Keep the two in step.
- Share image: edit `docs/og/og.html` (it copies the hero SVG), then render it:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1200,630 --virtual-time-budget=5000 --screenshot=docs/assets/og-image.png http://localhost:<port>/og/og.html`
  (serve `docs/` first), then bump the `?v=` on `og:image`.

## Testing the app without signing in

Serve a copy of `Index.html` with `<?= initialScan ?>` removed, plus a script
before the app's own script that fakes `google.script.run` (`getAppData`,
`getThumbnails`, …) with sample manuals and codes. Then screenshot it in
headless Chrome or puppeteer-core at 1352×690, 1440×900 and 390×844, in both
themes.
