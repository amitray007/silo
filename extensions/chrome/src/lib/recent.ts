/**
 * Tracks the last 5 link ids this extension captured, in
 * `chrome.storage.local` — NOT a link browser (the web UI/CLI are for
 * reading; see the brief's "Recent captures (last 5)" spec). The popup
 * fetches each tracked id fresh (`GET /api/links/:id`) on open, so it shows
 * live enrichment state rather than a stale snapshot.
 */

const STORAGE_KEY = 'silo.recentIds';
const MAX_RECENT = 5;

/** Reads the tracked recent ids, most-recent first. */
export async function getRecentIds(): Promise<string[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const ids = stored[STORAGE_KEY];
  return Array.isArray(ids) ? (ids as string[]) : [];
}

/** Prepends `id` to the recent list, de-duplicating and capping at `MAX_RECENT`. */
export async function trackCapturedId(id: string): Promise<void> {
  const existing = await getRecentIds();
  const next = [id, ...existing.filter((existingId) => existingId !== id)].slice(0, MAX_RECENT);
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}
