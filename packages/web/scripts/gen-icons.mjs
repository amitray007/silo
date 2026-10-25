#!/usr/bin/env node
/**
 * Generates all favicon/PWA/apple-touch raster icons from the two committed
 * SVG sources, into `packages/web/public/`. Reproducible (no system deps
 * beyond `sharp`/`png-to-ico`, both pure npm packages with prebuilt
 * binaries) and effectively idempotent — re-running with unchanged sources
 * reproduces the same icons. (PNG bytes are deterministic for a fixed
 * sharp/libvips build; a different platform or libvips version may encode
 * byte-different PNGs, so don't gate CI on a `git diff` after this runs.)
 *
 * Both SVG sources use the orange tile mark from the approved redesign.
 * favicon.svg drives browser-tab sizes; app-icon.svg drives install icons.
 * Run: `pnpm --filter @silo/web gen-icons`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const faviconSvg = join(publicDir, 'favicon.svg');
const appIconSvg = join(publicDir, 'app-icon.svg');

for (const src of [faviconSvg, appIconSvg]) {
  if (!existsSync(src)) {
    console.error(`[gen-icons] missing source SVG: ${src}`);
    process.exit(1);
  }
}

const faviconSvgBuffer = readFileSync(faviconSvg);
const appIconSvgBuffer = readFileSync(appIconSvg);

/**
 * Fail loudly if a source SVG isn't valid, renderable XML BEFORE writing any
 * raster. The old favicon.svg once carried a literal `--` inside an XML
 * comment (`--mark`), which strict parsers (sharp/librsvg) reject outright —
 * that silently broke this whole pipeline. `sharp().metadata()` runs the
 * librsvg parse without emitting a file, so a malformed source dies here with
 * a clear message instead of writing partial/corrupt icons downstream.
 */
async function assertRenderable(svgBuffer, label) {
  try {
    await sharp(svgBuffer).metadata();
  } catch (err) {
    console.error(`[gen-icons] source SVG is not renderable (${label}): ${err.message}`);
    process.exit(1);
  }
}

/** Renders an SVG buffer to a square PNG at `size`x`size` and writes it to `public/<name>`. */
async function renderPng(svgBuffer, size, name) {
  const outPath = join(publicDir, name);
  const png = await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(outPath, png);
  console.log(`[gen-icons] wrote ${name} (${size}x${size})`);
  return outPath;
}

async function main() {
  await assertRenderable(faviconSvgBuffer, 'favicon.svg');
  await assertRenderable(appIconSvgBuffer, 'app-icon.svg');

  // Orange tile favicon.svg -> small browser-tab favicons.
  const favicon16 = await renderPng(faviconSvgBuffer, 16, 'favicon-16x16.png');
  const favicon32 = await renderPng(faviconSvgBuffer, 32, 'favicon-32x32.png');
  const favicon48 = await renderPng(faviconSvgBuffer, 48, 'favicon-48x48.png');

  // Orange tile app-icon.svg -> anything that installs to a Dock/home-screen.
  await renderPng(appIconSvgBuffer, 180, 'apple-touch-icon.png');
  await renderPng(appIconSvgBuffer, 192, 'icon-192.png');
  await renderPng(appIconSvgBuffer, 512, 'icon-512.png');

  // Multi-res favicon.ico built from the favicon renders.
  const icoBuffer = await pngToIco([favicon16, favicon32, favicon48]);
  writeFileSync(join(publicDir, 'favicon.ico'), icoBuffer);
  console.log('[gen-icons] wrote favicon.ico (16/32/48 multi-res)');
}

await main();
