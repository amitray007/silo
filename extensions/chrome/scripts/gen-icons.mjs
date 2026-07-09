#!/usr/bin/env node
/**
 * Renders the four Chrome extension icon sizes (toolbar + Web Store) from
 * the dark-ground Stack app-icon SVG (`docs/design/app-icon/app-icon.svg`,
 * the same source used for the Mac app icon / PWA install icons in
 * packages/web). Extension icons install like an app icon in the toolbar,
 * so the dark-ground/plate version is used, not the transparent favicon.
 *
 * A small sibling script rather than importing packages/web's generator:
 * `extensions/chrome` is its own pnpm workspace package and does not depend
 * on `@silo/web` (nor should it, per the adapter boundary), so it carries
 * its own `sharp` devDependency and a standalone script — mirroring the
 * existing `scripts/zip.mjs` pattern (one small Node script per concern).
 *
 * Run: `node scripts/gen-icons.mjs` (from `extensions/chrome/`).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const iconsDir = join(root, 'public', 'icons');
const appIconSvg = join(root, '..', '..', 'docs', 'design', 'app-icon', 'app-icon.svg');

if (!existsSync(appIconSvg)) {
  console.error(`[gen-icons] missing source SVG: ${appIconSvg}`);
  process.exit(1);
}

const sizes = [16, 32, 48, 128];

async function main() {
  for (const size of sizes) {
    const outPath = join(iconsDir, `icon-${size}.png`);
    const png = await sharp(appIconSvg, { density: 384 }).resize(size, size).png().toBuffer();
    writeFileSync(outPath, png);
    console.log(`[gen-icons] wrote icons/icon-${size}.png (${size}x${size})`);
  }
}

await main();
