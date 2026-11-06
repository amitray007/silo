import type { ReaderRefresher } from '@silo/core';
import { readerContentSchema } from '@silo/core/capture';
import { readerAccessObservation } from '../extract/access.js';
import { type ExtractInput, type ExtractResult, extract } from '../extract/extract.js';
import { extractYouTubeWatch } from '../extract/youtube-watch.js';
import { readFeedMedia } from '../feeds/media.js';
import { HTML_ACCEPT, type SafeFetchResult, safeFetch } from '../fetch/safe-fetch.js';
import { otherSources, usesOtherSources } from './other-sources.js';
import { selectReader } from './select-reader.js';

/** Uses extract's existing single reader thread, shared with capture and live reads. */
export function createReaderRefresher(
  invalidate: (id: string) => void,
  deps: {
    sources?: typeof otherSources;
    fetch?: (url: string, signal: AbortSignal) => Promise<SafeFetchResult>;
    extract?: (input: ExtractInput) => Promise<ExtractResult>;
  } = {},
): ReaderRefresher {
  const fetch =
    deps.fetch ??
    ((url, signal) =>
      safeFetch(url, { responseHeaderNames: ['cf-mitigated'], accept: HTML_ACCEPT, signal }));
  const run = deps.extract ?? extract;
  return async (link, signal) => {
    if (signal.aborted) return { status: 'fetch_failed' };
    if (link.sourceKind === 'feed_media') return readFeedMedia(link.id, link.url, signal);
    const page = await fetch(link.url, signal);
    if (!page.ok || signal.aborted) {
      const failed = failedRead(page, signal);
      return recoverBlocked(link, failed, signal, invalidate, deps.sources);
    }
    const youtube =
      link.sourceKind === 'youtube' ? extractYouTubeWatch(page.html, page.finalUrl) : undefined;
    const extracted = await run({
      url: page.finalUrl,
      html: page.html,
      contentType: page.contentType,
    });
    if (signal.aborted) return { status: 'fetch_failed' };
    const result = await selectReader(link.sourceKind, extracted, youtube, {
      url: page.finalUrl,
      sourceUrl: link.url,
      sources: deps.sources,
      contentType: page.contentType,
      signal,
    });
    if (result.status !== 'reader') return result;
    const parsed = readerContentSchema.safeParse(result.reader);
    if (!parsed.success) return { status: 'fetch_failed' };
    invalidate(link.id);
    return { ...result, reader: parsed.data };
  };
}

function failedRead(page: SafeFetchResult, signal: AbortSignal) {
  return {
    status: 'fetch_failed' as const,
    ...(!signal.aborted ? { observation: readerAccessObservation(page) } : {}),
  };
}

async function recoverBlocked(
  link: { id: string; url: string; sourceKind: string },
  failed: ReturnType<typeof failedRead>,
  signal: AbortSignal,
  invalidate: (id: string) => void,
  sources = otherSources,
) {
  const result =
    failed.observation === 'blocked' && !signal.aborted && usesOtherSources(link.sourceKind)
      ? await sources(link.url, failed, signal)
      : failed;
  if (result.status === 'reader') invalidate(link.id);
  return result;
}
