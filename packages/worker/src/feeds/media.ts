import { getById, type ReaderExtraction, type SourceData, sourceDataSchema } from '@silo/core';
import { sanitizeRenderedPage } from '../extract/reader-worker.js';

export function feedMediaData(
  value: unknown,
): Extract<SourceData, { kind: 'feed_media' }> | undefined {
  const parsed = sourceDataSchema.safeParse(value);
  return parsed.success && parsed.data.kind === 'feed_media' ? parsed.data : undefined;
}

/** Show notes use the same bounded, terminable sanitizer as the page Reader. No media fetch. */
export async function extractFeedMedia(
  media: Extract<SourceData, { kind: 'feed_media' }>,
  url: string,
  signal: AbortSignal,
): Promise<ReaderExtraction> {
  const target = media.enclosureUrl
    ?.replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  const open = target ? `<p><a href="${target}">Open media</a></p>` : '';
  const page = await sanitizeRenderedPage(`${media.content}${open}`, url, signal);
  return page.reader
    ? { status: 'reader', reader: page.reader, ...(page.text ? { text: page.text } : {}) }
    : { status: 'no_reader' };
}

/** Refresh and legacy live reads rebuild from the saved publisher data, including Home copies. */
export async function readFeedMedia(
  id: string,
  url: string,
  signal: AbortSignal,
): Promise<ReaderExtraction> {
  const link = await getById(id);
  const media = feedMediaData(link?.sourceData);
  return media ? extractFeedMedia(media, url, signal) : { status: 'no_reader' };
}
