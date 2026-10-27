import { db, links } from '@silo/db';
import { inArray } from 'drizzle-orm';
import { canonicalize } from './canonicalize.js';
import { whereLive } from './live.js';

/** Match at most 50 input URLs to live canonical URLs in one query. */
export async function findSavedUrls(urls: readonly string[]): Promise<string[]> {
  const candidates = urls.slice(0, 50).flatMap((url) => {
    const result = canonicalize(url);
    return result.ok ? [{ url, canonical: result.canonical }] : [];
  });
  if (candidates.length === 0) return [];

  const rows = await db
    .select({ canonicalUrl: links.canonicalUrl })
    .from(links)
    .where(
      whereLive(inArray(links.canonicalUrl, [...new Set(candidates.map((c) => c.canonical))])),
    );
  const saved = new Set(rows.map((row) => row.canonicalUrl));
  return candidates.filter((candidate) => saved.has(candidate.canonical)).map(({ url }) => url);
}
