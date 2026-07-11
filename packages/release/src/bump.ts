/**
 * The apply layer: writes a computed version bump into a distributable's
 * package.json (and, for chrome, its manifest.json mirror). Unlike detect.ts
 * this DOES touch the filesystem — kept thin and separately testable so the
 * pure decision logic in detect.ts stays fs-free.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BumpKind, Distributable } from './detect.js';
import { nextVersion } from './detect.js';

/**
 * The package.json (and, for chrome, manifest.json) path(s) to rewrite for
 * each distributable, relative to the repo root. The first entry is always
 * the "primary" package.json — the source of truth `readVersion` reads from.
 * Every entry in the list gets the new version written so mirrors (chrome's
 * manifest, read by the Web Store) never drift from their package.json.
 */
const VERSION_FILES: Record<Distributable, readonly string[]> = {
  chrome: ['extensions/chrome/package.json', 'extensions/chrome/public/manifest.json'],
  raycast: ['extensions/raycast/package.json'],
  cli: ['packages/cli/package.json'],
};

function readJsonVersion(filePath: string): string {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };

  if (typeof parsed.version !== 'string') {
    throw new Error(`${filePath}: missing or non-string "version" field`);
  }

  return parsed.version;
}

function writeJsonVersion(filePath: string, version: string): void {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.version = version;
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

/** Reads the current version from a distributable's primary package.json. */
export function readVersion(distributable: Distributable, repoRoot: string): string {
  const [primary] = VERSION_FILES[distributable];

  if (!primary) {
    throw new Error(`readVersion: no version files registered for "${distributable}"`);
  }

  return readJsonVersion(join(repoRoot, primary));
}

/**
 * Reads the current version, computes the next one for `kind`, and writes it
 * into every version file registered for `distributable` (preserving 2-space
 * JSON formatting + a trailing newline). Returns the `{ from, to }` pair.
 */
export function applyBump(
  distributable: Distributable,
  kind: BumpKind,
  repoRoot: string,
): { from: string; to: string } {
  const from = readVersion(distributable, repoRoot);
  const to = nextVersion(from, kind);

  for (const relativePath of VERSION_FILES[distributable]) {
    writeJsonVersion(join(repoRoot, relativePath), to);
  }

  return { from, to };
}

/** The release tag for a distributable at a given version, e.g. `chrome-v0.1.1`. */
export function tagFor(distributable: Distributable, version: string): string {
  return `${distributable}-v${version}`;
}
