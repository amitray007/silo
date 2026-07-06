/**
 * Shared "fetch a URL via the SSRF-safe fetcher, then parse+guard its body as
 * a JSON object" step — every per-source enricher (HN/GitHub/YouTube, plan
 * 012) does exactly this before shaping its own `SourceData` variant. Kept
 * here as one small helper instead of three near-identical inline copies.
 *
 * Degrades to `undefined` on ANY failure — a non-ok fetch, invalid JSON, or a
 * body that isn't a JSON object (including a bare `null`, which e.g.
 * Firebase's HN API returns for a nonexistent item) — matching every
 * enricher's own "never throw, just resolve undefined" contract.
 */

import type { SafeFetchResult } from '../fetch/safe-fetch.js';

export async function fetchJsonObject(
  url: string,
  fetchFn: (url: string) => Promise<SafeFetchResult>,
): Promise<Record<string, unknown> | undefined> {
  const result = await fetchFn(url);
  if (!result.ok) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.html);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;

  return parsed as Record<string, unknown>;
}
