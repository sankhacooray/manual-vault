# Manual Vault

Trash the paper. Scan the QR code on a physical product manual, open the PDF instantly, and keep a digital copy in a **Manual Vault** folder in your own Google Drive — indexed and searchable with Claude.

- **Live app:** https://manuals.sankhacooray.com (thin GitHub Pages wrapper that launches the Apps Script web app)
- **Platform:** Google Apps Script web app (`executeAs: USER_ACCESSING`) — every user signs in with their own Google account and the vault folder is created in *their* Drive.

## How it works

1. Press **Scan & Save** — the camera opens with a QR scanner (photo-capture fallback for browsers that block the camera inside the Apps Script iframe).
2. When a QR code resolves to a PDF URL, the PDF is opened in a new tab and simultaneously saved into the `Manual Vault` Drive folder, with a floating progress indicator.
3. If you've added an Anthropic API key (Settings), Claude reads the PDF and returns title / brand / model / category / tags / summary. The result is written to `manual-vault-index.json` inside the vault folder and the Drive file is renamed to a friendly title.
4. The home view offers a central search panel over the Claude-built index, category chips, and the full document list.

## Permission model (deliberately narrow)

| Scope | Why |
|---|---|
| `drive.file` | The app can only see and touch files/folders **it created itself**. No read/write/delete access to anything else in your Drive. |
| `script.external_request` | Downloading the manual PDF and calling the Claude API. |
| `userinfo.email` | Showing who is signed in. |

The Anthropic API key is stored per-user in Apps Script **user properties** (never in the repo, never shared between users).

## Repo layout

```
manual-vault/
├── appscript/          # clasp-managed Apps Script project
│   ├── src/            # ← the actual Apps Script source (pushed to script.google.com)
│   │   ├── appsscript.json
│   │   ├── Code.js     # server: Drive save, index JSON, Claude call
│   │   └── Index.html  # client: scanner, search, categories, settings
│   ├── deploy.js       # push + redeploy to the fixed deployment ID (stable URL)
│   ├── fetch.js        # pull web-IDE edits back into src/
│   └── package.json
└── docs/               # GitHub Pages site (manuals.sankhacooray.com)
    ├── index.html      # thin landing wrapper → launches the web app
    └── CNAME
```

## Development

```bash
cd appscript
npm install
npx clasp --user bsc2fast login   # once, as bsc2fast@gmail.com
npm run push                      # push src/ to the Apps Script project
npm run deploy                    # release: push + redeploy to the stable /exec URL
npm run logs                      # tail execution logs
```

The Apps Script project is owned by `bsc2fast@gmail.com`. The web-app URL is pinned to a single deployment ID (see `appscript/deploy.js`), so releases never change the public URL.

## Why a wrapper page instead of an iframe?

Google sign-in refuses to render inside a cross-origin iframe, so the GitHub Pages site is a thin launcher that links to the Apps Script `/exec` URL rather than embedding it.
