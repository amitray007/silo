import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyBump, readVersion, tagFor } from './bump.js';

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function seedCliAt(repoRoot: string, version: string): void {
  const dir = join(repoRoot, 'packages/cli');
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'package.json'), { name: '@silo/cli', version });
}

function seedChromeAt(repoRoot: string, version: string): void {
  const pkgDir = join(repoRoot, 'extensions/chrome');
  const publicDir = join(pkgDir, 'public');
  mkdirSync(publicDir, { recursive: true });
  writeJson(join(pkgDir, 'package.json'), { name: '@silo/extension-chrome', version });
  writeJson(join(publicDir, 'manifest.json'), {
    manifest_version: 3,
    name: 'silo capture',
    version,
  });
}

describe('bump (fixture-backed)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'silo-release-bump-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('readVersion reads the primary package.json for cli', () => {
    seedCliAt(repoRoot, '0.1.0');
    expect(readVersion('cli', repoRoot)).toBe('0.1.0');
  });

  it('applyBump patch-bumps cli and rewrites its package.json', () => {
    seedCliAt(repoRoot, '0.1.0');

    const result = applyBump('cli', 'patch', repoRoot);

    expect(result).toEqual({ from: '0.1.0', to: '0.1.1' });
    expect(readVersion('cli', repoRoot)).toBe('0.1.1');
  });

  it('applyBump rewrites BOTH package.json and manifest.json for chrome, preserving 2-space indent', () => {
    seedChromeAt(repoRoot, '0.1.0');

    const result = applyBump('chrome', 'patch', repoRoot);

    expect(result).toEqual({ from: '0.1.0', to: '0.1.1' });

    const pkgPath = join(repoRoot, 'extensions/chrome/package.json');
    const manifestPath = join(repoRoot, 'extensions/chrome/public/manifest.json');

    const pkgRaw = readFileSync(pkgPath, 'utf8');
    const manifestRaw = readFileSync(manifestPath, 'utf8');

    expect(JSON.parse(pkgRaw).version).toBe('0.1.1');
    expect(JSON.parse(manifestRaw).version).toBe('0.1.1');

    // 2-space indent + trailing newline preserved.
    expect(pkgRaw).toContain('\n  "version": "0.1.1"');
    expect(pkgRaw.endsWith('\n')).toBe(true);
    expect(manifestRaw).toContain('\n  "version": "0.1.1"');
    expect(manifestRaw.endsWith('\n')).toBe(true);
  });

  it('applyBump minor/major compute correctly through the fixture', () => {
    seedCliAt(repoRoot, '0.1.0');
    expect(applyBump('cli', 'minor', repoRoot)).toEqual({ from: '0.1.0', to: '0.2.0' });

    seedCliAt(repoRoot, '0.1.0');
    expect(applyBump('cli', 'major', repoRoot)).toEqual({ from: '0.1.0', to: '1.0.0' });
  });

  it('tagFor formats the release tag', () => {
    expect(tagFor('chrome', '0.1.1')).toBe('chrome-v0.1.1');
    expect(tagFor('cli', '1.0.0')).toBe('cli-v1.0.0');
    expect(tagFor('raycast', '0.2.0')).toBe('raycast-v0.2.0');
  });
});
