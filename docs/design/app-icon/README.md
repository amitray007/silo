# silo app icon — "Stack" (dark ground)

These are the source + rendered brand-icon assets for silo's Mac app icon.
No desktop app exists yet — this directory stages the assets for when one
does (Tauri/Electron, a future slice). The same source SVG already drives
the web app's PWA/apple-touch icons today via
`packages/web/scripts/gen-icons.mjs` and the Chrome extension's toolbar
icons via `extensions/chrome/scripts/gen-icons.mjs`.

Contents:
- `app-icon.svg` — the canonical source. 1024×1024 viewBox, dark (ink)
  ground `#241d16→#14100b`, squircle plate, the "Stack" mark (three bars)
  with the vivid amber grain gradient on top. See
  `docs/superpowers/specs/2026-07-10-stack-brand-mark-design.md` for the
  canonical geometry this was drafted from.
- `app-icon-1024.png` — the 1024×1024 master PNG render, for anywhere a
  flat raster master is needed (App Store Connect, marketing, etc.).
- `silo.icns` — a macOS multi-resolution icon bundle, built from a
  `.iconset` (10 sizes: 16/32/128/256/512, each with a @2x variant) via
  `iconutil`. Ready to drop into an `.app` bundle's `Contents/Resources/`
  once a desktop shell exists.

## Regenerating

Requires `sharp` (already a devDependency of `extensions/chrome`, reused
here) and macOS's built-in `iconutil` (`/usr/bin/iconutil`).

```bash
# From the repo root:

# 1. Master 1024 PNG
node -e "
import('sharp').then(async ({ default: sharp }) => {
  const fs = require('fs');
  const png = await sharp('docs/design/app-icon/app-icon.svg', { density: 384 })
    .resize(1024, 1024).png().toBuffer();
  fs.writeFileSync('docs/design/app-icon/app-icon-1024.png', png);
});
"

# 2. .icns via a temporary .iconset
mkdir -p /tmp/silo.iconset
node -e "
import('sharp').then(async ({ default: sharp }) => {
  const fs = require('fs');
  const specs = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of specs) {
    const png = await sharp('docs/design/app-icon/app-icon.svg', { density: 384 })
      .resize(size, size).png().toBuffer();
    fs.writeFileSync('/tmp/silo.iconset/' + name, png);
  }
});
"
iconutil -c icns /tmp/silo.iconset -o docs/design/app-icon/silo.icns
rm -rf /tmp/silo.iconset
```

The commands above run from `extensions/chrome/` (or any workspace
package with `sharp` installed) so the dynamic `import('sharp')` resolves;
adjust the relative path to `app-icon.svg` accordingly if run elsewhere.
