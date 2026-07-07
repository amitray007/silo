#!/usr/bin/env node
/**
 * Zips `dist/` into `dist-zip/silo-capture.zip` — the packed artifact for
 * loading via drag-and-drop or the Chrome Web Store, alongside the "Load
 * unpacked" `dist/` folder itself. Run as a `postbuild`-style step from
 * `package.json`'s `build` script.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(root, 'dist');
const outDir = join(root, 'dist-zip');
const outFile = join(outDir, 'silo-capture.zip');

if (!existsSync(distDir)) {
  console.error('[zip] dist/ not found — run the vite build first.');
  process.exit(1);
}

function listFiles(dir, base = '') {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = join(base, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFiles(full, rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

// Sanity: make sure the vite build actually produced something before we
// bother invoking `zip` on it.
const files = listFiles(distDir);
if (files.length === 0) {
  console.error('[zip] dist/ is empty — build produced nothing.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// Prefer the system `zip` binary (present on macOS/Linux dev machines and CI
// images) over adding an archiver dependency for a small dev-convenience
// script — this is not part of the runtime the API/extensions ship. If it's
// unavailable, `dist/` is still loadable via "Load unpacked" — a missing
// zip artifact is a soft failure, not a build failure.
try {
  execFileSync('zip', ['-r', '-q', outFile, '.'], { cwd: distDir, stdio: 'inherit' });
  console.log(`[zip] wrote ${outFile}`);
} catch (error) {
  console.warn(
    '[zip] system `zip` binary unavailable or failed — skipping archive.',
    error instanceof Error ? error.message : error,
  );
}
