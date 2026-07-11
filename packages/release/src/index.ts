/**
 * Public entry for @silo/release. This package is CI tooling — its functions
 * are consumed by the release-on-merge GitHub Actions workflow (Unit 2 of the
 * releases-and-versioning slice), not by any other @silo package at runtime.
 * Re-exported here as a single barrel so knip has one entry point to trace
 * usage from (see the `packages/release` override in knip.json).
 */

export { applyBump, readVersion, tagFor } from './bump.js';
export type { BumpKind, Distributable } from './detect.js';
export { bumpKind, distributablesForPaths, nextVersion } from './detect.js';
export { planReleases, type ReleasePlanEntry } from './run.js';
