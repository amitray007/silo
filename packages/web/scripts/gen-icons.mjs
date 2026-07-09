#!/usr/bin/env node
/**
 * Generates all favicon/PWA/apple-touch raster icons from the two committed
 * SVG sources, into `packages/web/public/`. Reproducible (no system deps
 * beyond `sharp`/`png-to-ico`, both pure npm packages with prebuilt
 * binaries) and idempotent — re-running with unchanged sources produces
 * byte-identical output (sharp's PNG encoder is deterministic for a given
 * input + options).
 *
 * TWO sources, deliberately not one — see docs/superpowers/specs/2026-07-10-stack-brand-mark-design.md:
 *   - `favicon.svg`  — transparent ground, light-ink Stack mark. Used for the
 *     small browser-tab favicons, which sit on the browser's own chrome and
 *     must not carry an opaque plate.
 *   - `app-icon.svg` — dark (ink) ground, squircle plate, vivid amber grain.
 *     Used for anything that INSTALLS to a Dock/home-screen (apple-touch-icon,
 *     the 192/512 PWA manifest icons) — those need to look like a real app
 *     icon, not a favicon, so the dark ground + plate always render there.
 *
 * Run: `pnpm --filter web gen-icons`
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

/** Renders an SVG buffer to a square PNG at `size`x`size` and writes it to `public/<name>`. */
async function renderPng(svgBuffer, size, name) {
  const outPath = join(publicDir, name);
  const png = await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(outPath, png);
  console.log(`[gen-icons] wrote ${name} (${size}x${size})`);
  return outPath;
}

async function main() {
  // Transparent favicon.svg -> small browser-tab favicons.
  const favicon16 = await renderPng(faviconSvgBuffer, 16, 'favicon-16x16.png');
  const favicon32 = await renderPng(faviconSvgBuffer, 32, 'favicon-32x32.png');
  const favicon48 = await renderPng(faviconSvgBuffer, 48, 'favicon-48x48.png');

  // Dark-ground app-icon.svg -> anything that installs to a Dock/home-screen.
  await renderPng(appIconSvgBuffer, 180, 'apple-touch-icon.png');
  await renderPng(appIconSvgBuffer, 192, 'icon-192.png');
  await renderPng(appIconSvgBuffer, 512, 'icon-512.png');

  // Multi-res favicon.ico built from the transparent favicon renders.
  const icoBuffer = await pngToIco([favicon16, favicon32, favicon48]);
  writeFileSync(join(publicDir, 'favicon.ico'), icoBuffer);
  console.log('[gen-icons] wrote favicon.ico (16/32/48 multi-res)');
}

await main();
