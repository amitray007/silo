import type { ReaderExtraction } from '@silo/core';
import type { ExtractResult } from '../extract/extract.js';
import type { extractYouTubeWatch } from '../extract/youtube-watch.js';

/** Capture and refresh must choose the same Reader and matching search text. */
export function selectReader(
  sourceKind: string,
  extracted: ExtractResult,
  youtube: ReturnType<typeof extractYouTubeWatch>,
): ReaderExtraction {
  if (extracted.readerFailed && !youtube?.reader) return { status: 'fetch_failed' };
  const reader = youtube?.reader ?? extracted.reader;
  const text =
    sourceKind === 'youtube'
      ? (youtube?.text ?? extracted.description ?? extracted.text)
      : extracted.text;
  return {
    ...(reader ? { status: 'reader', reader } : { status: 'no_reader' }),
    ...(text?.trim() ? { text } : {}),
  };
}
