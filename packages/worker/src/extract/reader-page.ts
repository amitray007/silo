import { detectSource, type ReaderContent } from '@silo/core/capture';
import { Defuddle } from 'defuddle/node';
import { JSDOM, VirtualConsole } from 'jsdom';
import { parseHTML } from 'linkedom';
import { isChallengePage } from './challenge-page.js';
import { recoverEmbeddedJson } from './embedded-json.js';
import { FULL_TEXT_THRESHOLD } from './extract-constants.js';
import { sanitizeReaderContent } from './reader-content.js';
import { enrichRichBlocks, prepareCodeLanguages, prepareGists } from './rich-blocks.js';
import { extractYouTubeWatch } from './youtube-watch.js';

export interface PageContent {
  text?: string;
  reader?: ReaderContent;
  title?: string;
  description?: string;
  videoDescription?: boolean;
  challenge?: boolean;
}

/** Suppress stylesheet-parser noise while keeping other jsdom errors visible. */
export function buildExtractVirtualConsole(): VirtualConsole {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    if (error.message !== 'Could not parse CSS stylesheet') console.error(error);
  });
  return virtualConsole;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function readerFromText(dom: JSDOM, text: string, url: string): ReaderContent | undefined {
  const paragraph = dom.window.document.createElement('p');
  paragraph.textContent = text;
  return sanitizeReaderContent(paragraph.outerHTML, url, dom);
}

/** Runs only in a terminable thread. No scripts, remote resources, or async extractors. */
export async function extractPageContent(
  html: string,
  url: string,
  description?: string,
): Promise<PageContent> {
  const dom = new JSDOM(html, { url, virtualConsole: buildExtractVirtualConsole() });
  try {
    if (isChallengePage(dom.window.document)) return { challenge: true };
    const youtube = extractYouTubeWatch(html, url, dom);
    if (youtube?.text) {
      return {
        text: youtube.text,
        videoDescription: true,
        ...(youtube.title ? { title: youtube.title } : {}),
        ...(youtube.reader ? { reader: youtube.reader } : {}),
      };
    }
    if (detectSource(url).kind === 'youtube' && description) {
      const reader = readerFromText(dom, description, url);
      return { text: normalizeWhitespace(description), ...(reader ? { reader } : {}) };
    }
    return await extractDocument(dom, url);
  } finally {
    dom.window.close();
  }
}

async function extractDocument(dom: JSDOM, url: string): Promise<PageContent> {
  // jsdom repairs malformed HTML (notably the RFC's body/pre nesting). Defuddle's
  // selectors need linkedom; running directly on jsdom hits its selector limit.
  prepareGists(dom.window.document);
  prepareCodeLanguages(dom.window.document);
  const { document } = parseHTML(dom.serialize());
  Object.defineProperty(document, 'URL', { value: url, configurable: true });
  Object.defineProperty(document, 'styleSheets', { value: [] });
  const view = document.defaultView;
  if (view && !view.getComputedStyle) {
    Object.defineProperty(view, 'getComputedStyle', {
      value: () => ({ display: '' }),
      configurable: true,
    });
  }
  const article = await Defuddle(document, url, {
    useAsync: false,
    fetch: async () => {
      throw new Error('Reader network access is disabled');
    },
  });
  const rich = dom.window.document.createElement('div');
  rich.innerHTML = article.content;
  await enrichRichBlocks(rich);
  const reader = sanitizeReaderContent(rich.innerHTML, url, dom);
  const result: PageContent = {};
  // Search text follows Defuddle's content, before the stored-HTML byte cap.
  const textContainer = document.createElement('div');
  textContainer.innerHTML = rich.innerHTML;
  const text = normalizeWhitespace(textContainer.textContent ?? '');
  if (text) result.text = text;
  if (reader) result.reader = reader;
  const defuddleText = result.text;
  applyRecovery(dom, url, result);
  // Embedded article recovery takes precedence over generic page text.
  if (result.text === defuddleText) applyThinTextFallback(dom.window.document, result);
  return result;
}

function applyRecovery(dom: JSDOM, url: string, result: PageContent): void {
  const text = result.text ?? '';
  if (text.length < FULL_TEXT_THRESHOLD) {
    const recovered = recoverEmbeddedJson(dom);
    if (recovered?.title) result.title = recovered.title;
    if (recovered?.description) result.description = recovered.description;
    if (recovered?.text && recovered.text.length > text.length) {
      result.text = recovered.text;
      const recoveredReader = readerFromText(dom, recovered.text, url);
      if (recoveredReader) result.reader = recoveredReader;
    }
  }
}

/** Recover search text only after severe pruning; never publish a generic body as Reader HTML. */
function applyThinTextFallback(document: Document, result: PageContent): void {
  const length = result.text?.length ?? 0;
  if (length >= 1_000) return;
  // Defuddle works on linkedom, so this original jsdom DOM is still available.
  for (const node of document.querySelectorAll(
    'script, style, nav, header, footer, aside, noscript, template, [hidden], [aria-hidden="true"]',
  ))
    node.remove();
  const main = document.querySelector('main, article') ?? document.body;
  const text = normalizeWhitespace(main?.textContent ?? '');
  if (text.length >= Math.max(FULL_TEXT_THRESHOLD, length * 5)) result.text = text;
}
