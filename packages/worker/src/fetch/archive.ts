import { z } from 'zod';
import { type SafeFetchResult, safeFetch } from './safe-fetch.js';

const availability = z.object({
  archived_snapshots: z.object({
    closest: z.object({ available: z.literal(true), timestamp: z.string().regex(/^\d{14}$/) }),
  }),
});

export function archiveSnapshot(date: Date): { stamp: string; date: Date } | undefined {
  if (!Number.isFinite(date.getTime())) return undefined;
  const stamp = date.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '');
  return /^\d{14}$/.test(stamp) ? { stamp, date } : undefined;
}

/** Only the validated timestamp is trusted; response URLs are never used. */
export async function findArchiveSnapshot(
  url: string,
  signal: AbortSignal,
  fetch: (url: string, signal: AbortSignal) => Promise<SafeFetchResult> = (url, signal) =>
    safeFetch(url, { signal, timeoutMs: 15_000 }),
): Promise<{ stamp: string; date: Date } | undefined> {
  try {
    const response = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      signal,
    );
    if (!response.ok) return undefined;
    const parsed = availability.safeParse(JSON.parse(response.html));
    if (!parsed.success) return undefined;
    const stamp = parsed.data.archived_snapshots.closest.timestamp;
    const date = new Date(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`,
    );
    return archiveSnapshot(date)?.stamp === stamp ? { stamp, date } : undefined;
  } catch {
    return undefined;
  }
}
