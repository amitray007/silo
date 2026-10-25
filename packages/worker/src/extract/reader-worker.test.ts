import { describe, expect, it, vi } from 'vitest';
import { extract } from './extract.js';
import * as readerWorker from './reader-worker.js';

const stuck = new URL('../test-support/stuck-transform.mjs', import.meta.url);

describe('Reader isolation', () => {
  it('terminates a non-yielding parser while the event loop stays responsive', async () => {
    let ticked = false;
    const timer = setTimeout(() => {
      ticked = true;
    }, 20);
    const started = Date.now();
    try {
      await expect(
        readerWorker.extractPage('', 'https://journal.example.org/', {
          timeoutMs: 100,
          entry: stuck,
        }),
      ).rejects.toThrow('reader-timeout');
      expect(ticked).toBe(true);
      expect(Date.now() - started).toBeLessThan(2_000);
      // A failed thread cannot poison the next real extraction.
      const page = await readerWorker.extractPage(
        '<p>Next article.</p>',
        'https://journal.example.org/',
      );
      expect(page.text).toContain('Next article.');
    } finally {
      clearTimeout(timer);
    }
  });

  it('keeps metadata without content when a real parser thread times out', async () => {
    const realExtractPage = readerWorker.extractPage;
    const spy = vi
      .spyOn(readerWorker, 'extractPage')
      .mockImplementation((html, url) =>
        realExtractPage(html, url, { timeoutMs: 100, entry: stuck }),
      );
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await extract({
        url: 'https://journal.example.org/',
        contentType: 'text/html',
        html: '<title>Captured title</title><meta name="description" content="Saved description"><article>Never parsed.</article>',
      });
      expect(result).toMatchObject({
        title: 'Captured title',
        description: 'Saved description',
        status: 'partial',
      });
      expect(result.text).toBeUndefined();
      expect(result.reader).toBeUndefined();
      expect(log).toHaveBeenCalledWith('[reader] extraction unavailable', 'reader-timeout');
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });
});
