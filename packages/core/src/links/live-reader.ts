import type { ReaderContent } from '../capture.js';

/** Process-local port. Only the composition root registers the worker implementation. */
export type LiveReader = (
  link: { id: string; url: string; sourceKind: string },
  signal: AbortSignal,
) => Promise<ReaderContent | undefined>;

let reader: LiveReader | undefined;

export function setLiveReader(next: LiveReader | undefined): void {
  reader = next;
}

/**
 * The formatted Reader HTML for a stored link, built from the live page. Nothing
 * is stored: the web app asks each time a link opens, and the worker caches
 * briefly. `undefined` means the page has no Reader content, could not be
 * fetched, or no reader is registered (tests, CLI).
 */
export async function readLive(
  link: { id: string; url: string; sourceKind: string },
  signal: AbortSignal,
): Promise<ReaderContent | undefined> {
  return reader ? reader(link, signal) : undefined;
}
