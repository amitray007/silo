# Silo app icon - orange tile

The approved October 2026 prototype replaces the dark Stack icon with an
orange tile and three white bars. The gradient runs from `#ffb23f` to
`#ff6a13` at 160 degrees. The bars have opacity 1, 0.72, and 0.46.

- `app-icon.svg` uses the prototype's 26px geometry and scales to all sizes.
  It matches `packages/web/public/app-icon.svg`.
- `app-icon-1024.png` is the master raster.
- `silo.icns` contains the macOS icon sizes. These assets are staged for a
  future desktop app.

Regenerate web favicons and PWA icons from the worktree root:

```sh
pnpm --filter @silo/web gen-icons
```

For the macOS assets, use `sharp` from `packages/web` to render this SVG at
1024px and at each iconset size (16, 32, 128, 256, 512px, plus each @2x
variant). Write the master here, then run `iconutil -c icns` on the temporary
`.iconset` directory to replace `silo.icns`. Remove the temporary directory.
The Chrome extension's separate icons are outside this redesign unit.
