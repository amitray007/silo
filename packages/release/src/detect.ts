/**
 * Path-scoped auto-bump detection.
 *
 * Pure functions only — no `fs`, no `git`. All inputs (changed paths, commit
 * messages) are passed in by the caller (the release workflow, Unit 2). This
 * keeps the mapping logic trivially unit-testable and free of CI plumbing.
 */

export type Distributable = 'chrome' | 'raycast' | 'cli';

const DISTRIBUTABLE_PREFIXES: ReadonlyArray<readonly [string, Distributable]> = [
  ['extensions/chrome/', 'chrome'],
  ['extensions/raycast/', 'raycast'],
  ['packages/cli/', 'cli'],
];

/**
 * Maps a set of changed file paths to the distributables that must be
 * bumped. A path only contributes if it falls under a distributable's own
 * directory — `packages/web`, `packages/api`, `packages/mcp`, `packages/core`,
 * and every other shared/internal package contribute nothing, so a commit
 * touching only those never triggers a release.
 *
 * Returns the sorted, de-duplicated set of distributables touched.
 */
export function distributablesForPaths(changedPaths: string[]): Distributable[] {
  const found = new Set<Distributable>();

  for (const path of changedPaths) {
    for (const [prefix, distributable] of DISTRIBUTABLE_PREFIXES) {
      if (path.startsWith(prefix)) {
        found.add(distributable);
      }
    }
  }

  return [...found].sort();
}

export type BumpKind = 'patch' | 'minor' | 'major';

/**
 * Scans commit messages for a bump-size override flag. Matching is a
 * case-insensitive substring search for `#major` / `#minor`. `#major` wins
 * over `#minor` if both are present; absent either flag, the bump is `patch`.
 */
export function bumpKind(commitMessages: string[]): BumpKind {
  const lower = commitMessages.map((message) => message.toLowerCase());

  if (lower.some((message) => message.includes('#major'))) {
    return 'major';
  }

  if (lower.some((message) => message.includes('#minor'))) {
    return 'minor';
  }

  return 'patch';
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Bumps a plain `X.Y.Z` semver string by the given kind. No pre-release/build
 * metadata handling — throws if `current` isn't a plain `X.Y.Z` triple.
 */
export function nextVersion(current: string, kind: BumpKind): string {
  const match = SEMVER_PATTERN.exec(current);

  if (!match) {
    throw new Error(`nextVersion: "${current}" is not a plain X.Y.Z semver string`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}
