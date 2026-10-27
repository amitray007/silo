import type { ReaderRefresher } from '@silo/core';
import { readerContentSchema } from '@silo/core/capture';
import { type ExtractInput, type ExtractResult, extract } from '../extract/extract.js';
import { extractYouTubeWatch } from '../extract/youtube-watch.js';
import { HTML_ACCEPT, type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';
import { selectReader } from './select-reader.js';

/** Uses extract's existing single reader thread, shared with capture and live reads. */
export function createReaderRefresher(
  invalidate: (id: string) => void,
  deps: {
    fetch?: (url: string, signal: AbortSignal) => Promise<SafeFetchResult>;
    extract?: (input: ExtractInput) => Promise<ExtractResult>;
  } = {},
): ReaderRefresher {
  const fetch = deps.fetch ?? ((url, signal) => safeFetch(url, { accept: HTML_ACCEPT, signal }));
  const run = deps.extract ?? extract;
  return async (link, signal) => {
    if (signal.aborted) return { status: 'fetch_failed' };
    const page = await fetch(link.url, signal);
    if (!page.ok || signal.aborted) return { status: 'fetch_failed' };
    const youtube =
      link.sourceKind === 'youtube' ? extractYouTubeWatch(page.html, page.finalUrl) : undefined;
    const extracted = await run({
      url: page.finalUrl,
      html: page.html,
      contentType: page.contentType,
    });
    if (signal.aborted) return { status: 'fetch_failed' };
    const result = selectReader(link.sourceKind, extracted, youtube);
    if (result.status !== 'reader') return result;
    const parsed = readerContentSchema.safeParse(result.reader);
    if (!parsed.success) return { status: 'fetch_failed' };
    invalidate(link.id);
    return { ...result, reader: parsed.data };
  };
}
