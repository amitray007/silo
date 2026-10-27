import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserResult } from '../browser/reader.js';
import type { ExtractResult } from '../extract/extract.js';
import { selectReader } from './select-reader.js';

const reader = { contentHtml: '<p>Static</p>', contentImages: [] };
const renderedReader = { contentHtml: '<p>Rendered</p>', contentImages: [] };
const staticResult: ExtractResult = { status: 'full', reader, text: 'a'.repeat(1_000) };
const options = (page?: BrowserResult) => ({
  url: 'https://final.example/article',
  render: vi.fn(async () => page),
});
afterEach(() => vi.unstubAllEnvs());

describe('stored Reader selection', () => {
  it.each([
    undefined,
    {},
    { text: 'rendered' },
    { reader: renderedReader, text: ' ' },
    { reader: renderedReader, text: 'x'.repeat(2_000), challenge: true },
  ])('retains static for missing, empty or challenged render', async (page) => {
    expect(await selectReader('link', staticResult, undefined, options(page))).toEqual({
      status: 'reader',
      reader,
      text: staticResult.text,
    });
  });
  it.each([
    ['exact boundary', 800, true],
    ['below boundary', 799, false],
    ['longer', 2_000, true],
  ] as const)('uses the 80 percent rule: %s', async (_name, length, rendered) => {
    const result = await selectReader(
      'link',
      staticResult,
      undefined,
      options({ reader: renderedReader, text: 'b'.repeat(length) }),
    );
    expect(result).toEqual(
      rendered
        ? { status: 'reader', reader: renderedReader, text: 'b'.repeat(length) }
        : { status: 'reader', reader, text: staticResult.text },
    );
  });
  it.each([undefined, '', 'a'.repeat(199)])(
    'uses a nonempty render when static is thin',
    async (text) => {
      const extracted: ExtractResult = {
        status: 'partial',
        ...(text !== undefined ? { text } : {}),
      };
      expect(
        await selectReader(
          'link',
          extracted,
          undefined,
          options({ reader: renderedReader, text: 'body' }),
        ),
      ).toEqual({ status: 'reader', reader: renderedReader, text: 'body' });
    },
  );
  it.each([
    ['no static images', 0, 0, true],
    ['all images lost', 1, 0, false],
    ['below half', 3, 1, false],
    ['exactly half', 4, 2, true],
    ['above half', 3, 2, true],
  ] as const)(
    'guards image retention: %s',
    async (_name, staticCount, renderedCount, useRendered) => {
      const images = (count: number) =>
        Array.from({ length: count }, (_, index) => `https://example.org/${index}.png`);
      const staticWithImages = { ...reader, contentImages: images(staticCount) };
      const renderedWithImages = { ...renderedReader, contentImages: images(renderedCount) };
      const log = vi.spyOn(console, 'debug').mockImplementation(() => {});
      try {
        // The image guard also applies when static text is below the text threshold.
        for (const text of ['thin', 'a'.repeat(1_000)]) {
          const result = await selectReader(
            'link',
            { ...staticResult, text, reader: staticWithImages },
            undefined,
            options({ reader: renderedWithImages, text: 'b'.repeat(2_000) }),
          );
          expect(result).toMatchObject({
            reader: useRendered ? renderedWithImages : staticWithImages,
          });
          expect(log).toHaveBeenLastCalledWith(
            '[reader] choice',
            expect.objectContaining({
              staticImageCount: staticCount,
              renderedImageCount: renderedCount,
              choice: useRendered ? 'rendered' : 'static',
            }),
          );
        }
      } finally {
        log.mockRestore();
      }
    },
  );
  it.each(['twitter', 'youtube', 'hacker_news', 'github'])(
    'keeps %s static without calling render',
    async (sourceKind) => {
      const opts = options({ reader: renderedReader, text: 'x'.repeat(2_000) });
      await selectReader(sourceKind, staticResult, undefined, opts);
      expect(opts.render).not.toHaveBeenCalled();
    },
  );
  it('passes the static final URL and cancellation signal to rendering', async () => {
    const opts = { ...options(), signal: new AbortController().signal };
    await selectReader('link', staticResult, undefined, opts);
    expect(opts.render).toHaveBeenCalledWith(opts.url, opts.signal);
  });
  it('preserves the previous result byte for byte when the endpoint is unset', async () => {
    vi.stubEnv('SILO_BROWSER_WS_ENDPOINT', '');
    expect(await selectReader('link', staticResult, undefined, { url: options().url })).toEqual({
      status: 'reader',
      reader,
      text: staticResult.text,
    });
    expect(
      await selectReader('link', { status: 'bare' }, undefined, { url: options().url }),
    ).toEqual({ status: 'no_reader' });
    expect(
      await selectReader('link', { status: 'partial', readerFailed: true }, undefined, {
        url: options().url,
      }),
    ).toEqual({ status: 'fetch_failed' });
  });
  it.each(['application/pdf', 'image/png', 'text/plain'])(
    'skips rendering for %s',
    async (contentType) => {
      const opts = { ...options(), contentType };
      await selectReader('link', staticResult, undefined, opts);
      expect(opts.render).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, '', 'TEXT/HTML; charset=utf-8', 'application/xhtml+xml'])(
    'allows HTML or missing MIME %s',
    async (contentType) => {
      const opts = { ...options(), contentType };
      await selectReader('link', staticResult, undefined, opts);
      expect(opts.render).toHaveBeenCalledOnce();
    },
  );
  it('returns static immediately when pre-aborted', async () => {
    const opts = { ...options(), signal: AbortSignal.abort() };
    expect(await selectReader('link', staticResult, undefined, opts)).toMatchObject({ reader });
    expect(opts.render).not.toHaveBeenCalled();
  });
  it('does not select a render that finishes after caller abort', async () => {
    const controller = new AbortController();
    const result = await selectReader('link', staticResult, undefined, {
      url: options().url,
      signal: controller.signal,
      render: async () => {
        controller.abort();
        return { reader: renderedReader, text: 'x'.repeat(2000) };
      },
    });
    expect(result).toEqual({ status: 'reader', reader, text: staticResult.text });
  });
  it('keeps static readable and marks infrastructure unavailability for retry', async () => {
    expect(
      await selectReader('link', staticResult, undefined, options({ renderPending: true })),
    ).toEqual({ status: 'reader', reader, text: staticResult.text, renderPending: true });
  });
  it('falls back when rendering throws', async () => {
    expect(
      await selectReader('link', staticResult, undefined, {
        url: options().url,
        render: async () => {
          throw new Error('offline');
        },
      }),
    ).toEqual({ status: 'reader', reader, text: staticResult.text, renderPending: true });
  });
});
