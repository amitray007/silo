import type { ReaderExtraction } from '@silo/core';
import { parseHTML } from 'linkedom';
import { type BrowserResult, renderReader } from '../browser/reader.js';
import { type ExtractResult, isHtmlContentType } from '../extract/extract.js';
import { FULL_TEXT_THRESHOLD } from '../extract/extract-constants.js';
import type { extractYouTubeWatch } from '../extract/youtube-watch.js';

/** Capture and refresh must choose the same Reader and matching search text. */
function staticReader(
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

const STATIC_SOURCES = new Set(['twitter', 'youtube', 'hacker_news', 'github']);

/** Stored capture paths share rendering; live extraction never calls this selector. */
export async function selectReader(
  sourceKind: string,
  extracted: ExtractResult,
  youtube: ReturnType<typeof extractYouTubeWatch>,
  options: {
    url: string;
    signal?: AbortSignal;
    contentType?: string | undefined;
    render?: (url: string, signal?: AbortSignal) => Promise<BrowserResult | undefined>;
  },
): Promise<ReaderExtraction> {
  const fallback = staticReader(sourceKind, extracted, youtube);
  if (
    STATIC_SOURCES.has(sourceKind) ||
    !isHtmlContentType(options.contentType) ||
    options.signal?.aborted
  ) {
    console.debug('[reader] choice', { rendered: 'skipped', choice: 'static' });
    return fallback;
  }
  if (!options.render && !process.env.SILO_BROWSER_WS_ENDPOINT?.trim()) {
    console.debug('[reader] choice', { rendered: 'skipped', choice: 'static' });
    return fallback;
  }
  const rendered = await (options.render ?? renderReader)(options.url, options.signal).catch(
    (): BrowserResult => ({ renderPending: true, renderOutcome: 'failed' }),
  );
  const staticLength = extracted.text?.length ?? 0;
  const renderedLength = rendered?.text?.trim().length ?? 0;
  const staticImageCount = extracted.reader?.contentImages.length ?? 0;
  const renderedImageCount = rendered?.reader?.contentImages.length ?? 0;
  const staticRich = richContent(extracted.reader?.contentHtml);
  const renderedRich = richContent(rendered?.reader?.contentHtml);
  const useRendered =
    !options.signal?.aborted &&
    !rendered?.challenge &&
    rendered?.reader &&
    renderedLength > 0 &&
    renderedImageCount >= staticImageCount / 2 &&
    renderedRich.diagrams >= staticRich.diagrams &&
    [...staticRich.gists].every((gist) => renderedRich.gists.has(gist)) &&
    (staticLength < FULL_TEXT_THRESHOLD || renderedLength >= staticLength * 0.8);
  console.debug('[reader] choice', {
    rendered: renderOutcome(rendered),
    staticLength,
    renderedLength,
    staticImageCount,
    renderedImageCount,
    choice: useRendered ? 'rendered' : 'static',
  });
  if (!useRendered || !rendered?.reader) return pendingFallback(fallback, rendered?.renderPending);
  return {
    status: 'reader',
    reader: rendered.reader,
    ...(rendered.text ? { text: rendered.text } : {}),
  };
}

/** Inspect sanitized structure, never source-code text that resembles an attribute. */
function richContent(html: string | undefined): { diagrams: number; gists: Set<string> } {
  const gists = new Set<string>();
  if (!html) return { diagrams: 0, gists };
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const figure of document.querySelectorAll('figure')) {
    const link = figure.querySelector('figcaption a[href]');
    const code = figure.querySelector('pre > code');
    const href = link?.getAttribute('href') ?? '';
    if (
      /^https:\/\/gist\.github\.com\/(?:[\w-]+\/)?[a-f\d]{5,40}(?:\?file=[^#]*)?$/i.test(href) &&
      code
    )
      gists.add(`${href}\n${link?.textContent}\n${code.textContent}`);
  }
  return { diagrams: document.querySelectorAll('pre > code[data-lang="mermaid"]').length, gists };
}

function pendingFallback(fallback: ReaderExtraction, pending?: boolean): ReaderExtraction {
  if (pending && fallback.status !== 'fetch_failed') return { ...fallback, renderPending: true };
  return fallback;
}

function renderOutcome(result: BrowserResult | undefined): string {
  if (result?.renderOutcome) return result.renderOutcome;
  if (result?.renderPending) return 'pending';
  return result?.reader && result.text?.trim() ? 'ok' : 'empty';
}
