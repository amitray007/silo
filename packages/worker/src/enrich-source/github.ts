/**
 * GitHub enricher — fetches the unauthed `GET /repos/{owner}/{repo}` REST
 * endpoint (60 req/hr rate limit per source IP, no key needed) and maps it
 * onto the `github` `SourceData` variant (source-data/rich-previews slice,
 * plan 012).
 *
 * GitHub REQUIRES a `User-Agent` header on every request (undocumented-until-
 * you-hit-it 403 otherwise) — `safeFetch`'s own fixed, module-level
 * `USER_AGENT` (see `fetch/safe-fetch.ts`) already sends a non-empty,
 * identifying value on every call, which is all GitHub's API actually
 * checks for (presence, not a specific string) — no extra header plumbing
 * needed on top of the plain `fetchFn` seam.
 *
 * Degrades gracefully on ANY failure (404 private/renamed/deleted repo, rate
 * limit, timeout, malformed JSON) — same contract as the HN enricher.
 * `/languages` (the per-language byte breakdown, for `languagePct`) is
 * DELIBERATELY NOT called — the plan calls this optional, and the primary
 * repo call already gives `language` (GitHub's own "primary language" guess),
 * which is enough for the v1 rich preview without a second API round-trip
 * (and a second unauthed-rate-limit consumption) per capture.
 */

import type { SourceData } from '@silo/core';
import { sourceDataSchema } from '@silo/core';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { fetchJsonObject } from './fetch-json.js';

/** The subset of GitHub's repo JSON this enricher actually reads. */
interface GitHubRepoResponse {
  stargazers_count?: unknown;
  forks_count?: unknown;
  open_issues_count?: unknown;
  description?: unknown;
  language?: unknown;
}

function repoUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

type GitHubSourceData = Extract<SourceData, { kind: 'github' }>;

/**
 * Fetch + shape a GitHub repo's `SourceData`. `fetchFn` is the SSRF-safe
 * fetcher — injected so tests can stub it without a real network call.
 */
export async function enrichGitHub(
  owner: string,
  repo: string,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<GitHubSourceData | undefined> {
  const parsed = await fetchJsonObject(repoUrl(owner, repo), fetchFn);
  if (parsed === undefined) return undefined;

  const data = parsed as GitHubRepoResponse;
  const candidate: Record<string, unknown> = {
    kind: 'github',
    stars: data.stargazers_count,
    forks: data.forks_count,
    issues: data.open_issues_count,
  };
  // `description`/`language` are `null` (not absent) upstream when GitHub has
  // none — only include them when they're a genuinely non-empty string, so
  // an omitted-vs-null repo field maps onto the schema's `.optional()`
  // (which rejects an explicit `null`) rather than failing validation.
  if (typeof data.description === 'string' && data.description.length > 0) {
    candidate.description = data.description;
  }
  if (typeof data.language === 'string' && data.language.length > 0) {
    candidate.language = data.language;
  }

  const shaped = sourceDataSchema.safeParse(candidate);
  return shaped.success && shaped.data.kind === 'github' ? shaped.data : undefined;
}
