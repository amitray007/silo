/**
 * The CI entrypoint (invoked by `.github/workflows/release.yml` on push to
 * `main`): wire the pure decision logic (`detect.ts`) + the fs apply layer
 * (`bump.ts`) to the workflow's inputs and emit its outputs.
 *
 * Inputs (via env, so the workflow can pass them from the git context):
 * - `RELEASE_CHANGED_PATHS`  — newline-separated repo-relative paths changed in
 *   the pushed range (the workflow computes this with `git diff --name-only`).
 * - `RELEASE_COMMIT_MESSAGES` — the pushed commits' messages, `\x00`-separated
 *   (NUL, so a message with newlines can't corrupt the split), used to detect a
 *   `#minor` / `#major` bump-size override.
 * - `GITHUB_OUTPUT` (set by Actions) — the file this appends step outputs to.
 *
 * Output: a single `releases` step-output — a JSON array of
 * `{ distributable, from, to, tag }`, one per distributable whose OWN files
 * changed (empty `[]` when only web/api/mcp/core/etc. changed → the workflow's
 * downstream jobs then no-op). Applying the bump (writing package.json +
 * chrome's manifest) is a SIDE EFFECT of this run — the workflow commits the
 * result and creates each tag. This module is deliberately the ONLY file in the
 * package that reads env / writes GITHUB_OUTPUT, so detect/bump stay pure +
 * unit-testable and this thin glue is what the workflow drives.
 */

import { appendFileSync } from 'node:fs';
import { applyBump, tagFor } from './bump.js';
import { bumpKind, distributablesForPaths } from './detect.js';

/** A single computed release — what the workflow builds + publishes downstream. */
export type ReleasePlanEntry = {
  distributable: ReturnType<typeof distributablesForPaths>[number];
  from: string;
  to: string;
  tag: string;
};

/**
 * The pure planner (no env, no GITHUB_OUTPUT — just the two raw inputs +
 * repoRoot), extracted so it's unit-testable without faking process env. It
 * DOES apply the bump to disk (`applyBump`) because the version files are the
 * durable record the workflow commits; returns the plan for the workflow's
 * outputs. Empty array ⇒ nothing to release.
 */
export function planReleases(
  changedPaths: string[],
  commitMessages: string[],
  repoRoot: string,
): ReleasePlanEntry[] {
  const distributables = distributablesForPaths(changedPaths);
  const kind = bumpKind(commitMessages);

  return distributables.map((distributable) => {
    const { from, to } = applyBump(distributable, kind, repoRoot);
    return { distributable, from, to, tag: tagFor(distributable, to) };
  });
}

/** Splits an env value that may be absent/empty into a clean list on `separator`. */
function splitEnv(value: string | undefined, separator: string): string[] {
  if (value === undefined || value === '') return [];
  return value.split(separator).filter((entry) => entry.length > 0);
}

function main(): void {
  const changedPaths = splitEnv(process.env.RELEASE_CHANGED_PATHS, '\n');
  // NUL-separated so a commit message containing newlines can't split wrong.
  const commitMessages = splitEnv(process.env.RELEASE_COMMIT_MESSAGES, '\x00');
  const repoRoot = process.env.RELEASE_REPO_ROOT ?? process.cwd();

  const plan = planReleases(changedPaths, commitMessages, repoRoot);

  // Human-readable log for the Actions run.
  if (plan.length === 0) {
    console.log('[release] no distributable files changed — nothing to release.');
  } else {
    for (const entry of plan) {
      console.log(`[release] ${entry.distributable}: ${entry.from} → ${entry.to} (${entry.tag})`);
    }
  }

  // Machine-readable output for the workflow's downstream jobs.
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `releases=${JSON.stringify(plan)}\n`);
  }
}

// Only run when invoked directly (`tsx src/run.ts`), not when imported by a
// test — same isMainModule idiom as the app entrypoints.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main();
}
