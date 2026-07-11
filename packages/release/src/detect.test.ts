import { describe, expect, it } from 'vitest';
import { bumpKind, distributablesForPaths, nextVersion } from './detect.js';

describe('distributablesForPaths', () => {
  it('maps chrome-only paths to chrome', () => {
    expect(distributablesForPaths(['extensions/chrome/src/background/service-worker.ts'])).toEqual([
      'chrome',
    ]);
  });

  it('maps raycast-only paths to raycast', () => {
    expect(distributablesForPaths(['extensions/raycast/src/save-to-silo.tsx'])).toEqual([
      'raycast',
    ]);
  });

  it('maps cli-only paths to cli', () => {
    expect(distributablesForPaths(['packages/cli/src/main.ts'])).toEqual(['cli']);
  });

  it('ignores web/api/mcp/core-only changes', () => {
    expect(
      distributablesForPaths([
        'packages/web/src/App.tsx',
        'packages/api/src/routes/links.ts',
        'packages/mcp/server/src/index.ts',
        'packages/core/src/links/create.ts',
      ]),
    ).toEqual([]);
  });

  it('ignores other shared/internal packages and root/docs files', () => {
    expect(
      distributablesForPaths([
        'packages/db/src/schema.ts',
        'packages/queue/src/index.ts',
        'packages/worker/src/index.ts',
        'packages/app/src/main.ts',
        'docs/releasing.md',
        'README.md',
        'package.json',
      ]),
    ).toEqual([]);
  });

  it('ignores web when mixed with a chrome change — only chrome bumps', () => {
    expect(
      distributablesForPaths([
        'extensions/chrome/src/options/options.ts',
        'packages/web/src/App.tsx',
      ]),
    ).toEqual(['chrome']);
  });

  it('returns all touched distributables, sorted and de-duplicated', () => {
    expect(
      distributablesForPaths([
        'packages/cli/src/main.ts',
        'packages/cli/src/main.ts',
        'extensions/raycast/src/search-silo.tsx',
        'extensions/chrome/src/options/options.ts',
      ]),
    ).toEqual(['chrome', 'cli', 'raycast']);
  });

  it('returns an empty array for empty input', () => {
    expect(distributablesForPaths([])).toEqual([]);
  });
});

describe('bumpKind', () => {
  it('defaults to patch when no flag is present', () => {
    expect(bumpKind(['fix: typo', 'chore: bump deps'])).toBe('patch');
  });

  it('returns minor when #minor is present', () => {
    expect(bumpKind(['feat: add search #minor'])).toBe('minor');
  });

  it('returns major when #major is present', () => {
    expect(bumpKind(['feat!: breaking change #major'])).toBe('major');
  });

  it('prefers major over minor when both are present', () => {
    expect(bumpKind(['#minor', '#major'])).toBe('major');
  });

  it('matches case-insensitively', () => {
    expect(bumpKind(['feat: X #MAJOR'])).toBe('major');
    expect(bumpKind(['feat: X #Minor'])).toBe('minor');
  });

  it('returns patch for empty input', () => {
    expect(bumpKind([])).toBe('patch');
  });
});

describe('nextVersion', () => {
  it('bumps patch', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1');
  });

  it('bumps minor and resets patch', () => {
    expect(nextVersion('0.1.0', 'minor')).toBe('0.2.0');
  });

  it('bumps major and resets minor + patch', () => {
    expect(nextVersion('0.1.0', 'major')).toBe('1.0.0');
  });

  it('throws on a non X.Y.Z input like "x.y"', () => {
    expect(() => nextVersion('x.y', 'patch')).toThrow();
  });

  it('throws on other non-semver input', () => {
    expect(() => nextVersion('1.2', 'patch')).toThrow();
    expect(() => nextVersion('1.2.3-beta', 'patch')).toThrow();
    expect(() => nextVersion('', 'patch')).toThrow();
  });
});
