# @silo/extension-chrome

A Manifest V3 Chrome extension: one-keystroke capture of the current page into
silo. Capture is instant and quiet — the extension never shows enrichment
data (silo's backend job); its whole job is "save this, fast, and confirm it
landed."

## Features

- **Toolbar action** — click the icon to open the popup (title + optional
  note + tag autocomplete, plus a "recently saved" list of your last 5
  captures).
- **Keyboard command** — `Cmd/Ctrl+Shift+S` captures the active tab instantly,
  with no popup. Feedback is a small toast injected into the page: "Link
  saved in silo", "Already in silo (updated)" on dedup, or a clear error if
  silo is unreachable.
- **Right-click menu** — "Save to silo" on a page or a specific link.
- Non-http(s) tabs (`chrome://`, `about:`, `file://`, …) are disabled —
  nothing happens if you try to capture one.

## Build

```sh
pnpm --filter @silo/extension-chrome build
```

Outputs a loadable `dist/` folder and a packaged `dist-zip/silo-capture.zip`.

## Load unpacked (development)

1. Run the build above.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select `extensions/chrome/dist/`.
5. Pin the "silo capture" icon to your toolbar.

## Configure

Open the extension's **options** page (right-click the icon → Options, or
`chrome://extensions` → silo capture → Details → Extension options):

- **Base URL** — the silo API this extension talks to. Defaults to
  `http://localhost:8787`. Saving requests the matching host permission at
  runtime (MV3 optional host permissions — no re-install needed).
- **API token** — only needed if the silo server sets `SILO_API_TOKEN`. Sent
  as `Authorization: Bearer <token>` on every request once set.

## Cross-origin (CORS) setup

The silo API only allows browser requests from origins listed in
`SILO_ALLOWED_ORIGINS` (see `packages/api/src/cors.ts`). A packed/loaded
Chrome extension's origin is `chrome-extension://<extension-id>` — find your
extension's id on `chrome://extensions` (Developer mode), then add it to the
server's env, e.g.:

```sh
SILO_ALLOWED_ORIGINS="http://localhost:5173,http://localhost:8787,chrome-extension://<your-extension-id>"
```

Without this, the browser will block the extension's requests even though
`host_permissions`/the options page's base URL are configured correctly —
CORS and host permissions are two independent gates (see
`extensions/INTERFACES.md`).

## Test

```sh
pnpm --filter @silo/extension-chrome test
pnpm --filter @silo/extension-chrome check-types
```
