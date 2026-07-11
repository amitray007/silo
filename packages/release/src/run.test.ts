import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planReleases } from './run.js';

/**
 * `planReleases` over a fixture repo: it must (a) pick only the distributables
 * whose OWN paths changed, (b) apply the correct bump size, and (c) write the
 * new version into the fixture files. A throwaway repo dir per test keeps the
 * fs writes isolated.
 */
describe('planReleases', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'silo-release-'));
    // Minimal fixture: each distributable's version file at 0.1.0.
    mkdirSync(join(repoRoot, 'extensions/chrome/public'), { recursive: true });
    mkdirSync(join(repoRoot, 'extensions/raycast'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages/cli'), { recursive: true });
    const pkg = (name: string) => JSON.stringify({ name, version: '0.1.0' }, null, 2);
    writeFileSync(join(repoRoot, 'extensions/chrome/package.json'), pkg('chrome'));
    writeFileSync(join(repoRoot, 'extensions/chrome/public/manifest.json'), pkg('chrome-manifest'));
    writeFileSync(join(repoRoot, 'extensions/raycast/package.json'), pkg('raycast'));
    writeFileSync(join(repoRoot, 'packages/cli/package.json'), pkg('cli'));
  });

  afterEach(() => {
    // Best-effort cleanup; a leaked tmp dir is harmless.
  });

  const versionOf = (relPath: string): string =>
    (JSON.parse(readFileSync(join(repoRoot, relPath), 'utf8')) as { version: string }).version;

  it('a web-only change plans NO release and writes nothing', () => {
    const plan = planReleases(['packages/web/src/App.tsx'], ['fix: web thing'], repoRoot);
    expect(plan).toEqual([]);
    expect(versionOf('packages/cli/package.json')).toBe('0.1.0');
  });

  it('a cli change patch-bumps only the cli and returns its tag', () => {
    const plan = planReleases(['packages/cli/src/main.ts'], ['fix: cli bug'], repoRoot);
    expect(plan).toEqual([{ distributable: 'cli', from: '0.1.0', to: '0.1.1', tag: 'cli-v0.1.1' }]);
    expect(versionOf('packages/cli/package.json')).toBe('0.1.1');
    // The others are untouched.
    expect(versionOf('extensions/chrome/package.json')).toBe('0.1.0');
  });

  it('a chrome change bumps BOTH the package.json and the manifest (minor via #minor)', () => {
    const plan = planReleases(
      ['extensions/chrome/src/background/service-worker.ts'],
      ['feat: capture improvement #minor'],
      repoRoot,
    );
    expect(plan).toEqual([
      { distributable: 'chrome', from: '0.1.0', to: '0.2.0', tag: 'chrome-v0.2.0' },
    ]);
    expect(versionOf('extensions/chrome/package.json')).toBe('0.2.0');
    expect(versionOf('extensions/chrome/public/manifest.json')).toBe('0.2.0');
  });

  it('#major in a commit message forces a major bump', () => {
    const plan = planReleases(['packages/cli/src/x.ts'], ['feat!: rewrite #major'], repoRoot);
    expect(plan[0]?.to).toBe('1.0.0');
  });

  it('a change touching chrome AND web bumps only chrome (web is ignored)', () => {
    const plan = planReleases(
      ['extensions/chrome/src/x.ts', 'packages/web/src/y.tsx'],
      ['chore: both'],
      repoRoot,
    );
    expect(plan.map((entry) => entry.distributable)).toEqual(['chrome']);
  });

  it('a change touching multiple distributables plans a release for each', () => {
    const plan = planReleases(
      ['extensions/chrome/src/x.ts', 'packages/cli/src/y.ts', 'extensions/raycast/src/z.ts'],
      ['chore: sweep'],
      repoRoot,
    );
    expect(plan.map((entry) => entry.distributable).sort()).toEqual(['chrome', 'cli', 'raycast']);
    expect(plan.every((entry) => entry.to === '0.1.1')).toBe(true);
  });
});
