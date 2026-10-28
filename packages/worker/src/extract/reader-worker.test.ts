import { describe, expect, it, vi } from 'vitest';
import { extract } from './extract.js';
import * as readerWorker from './reader-worker.js';

const entry = new URL('../test-support/reader-thread.mjs', import.meta.url);
const url = 'https://journal.example.org/';

function pool() {
  return new readerWorker.ReaderPool({ timeoutMs: 150, startupTimeoutMs: 3_000, entry });
}

describe('Reader isolation', () => {
  it('reuses one ready thread and gives queued pages their own full deadline', async () => {
    const reader = pool();
    try {
      // Cold start is at least 250ms; ten queued pages add at least 300ms.
      // Each page still has only 150ms once dispatched.
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => reader.run(String(i), url)),
      );
      const threadIds = results.map((result) => result.text?.split(':')[0]);
      expect(new Set(threadIds).size).toBe(1);
      expect(results.map((result) => result.text?.split(':').slice(1).join(':'))).toEqual(
        Array.from({ length: 10 }, (_, i) => `${i + 1}:${i}`),
      );
    } finally {
      await reader.close();
    }
  });

  it('terminates a non-yielding parser and replaces it for the next queued page', async () => {
    const reader = pool();
    let ticked = false;
    const timer = setTimeout(() => {
      ticked = true;
    }, 20);
    try {
      const first = await reader.run('first', url);
      const started = Date.now();
      const timedOut = expect(reader.run('stuck', url)).rejects.toThrow('reader-timeout');
      const next = reader.run('next', url);
      await timedOut;
      expect(ticked).toBe(true);
      expect(Date.now() - started).toBeLessThan(2_000);
      const replacement = await next;
      expect(replacement.text?.split(':')[0]).not.toBe(first.text?.split(':')[0]);
      expect(replacement.text).toMatch(/:1:next$/);
    } finally {
      clearTimeout(timer);
      await reader.close();
    }
  });

  it('recovers from an exited thread and closes active and queued work', async () => {
    const reader = pool();
    try {
      await expect(reader.run('exit', url)).rejects.toThrow('reader-exited');
      expect((await reader.run('recovered', url)).text).toMatch(/:1:recovered$/);
      const active = expect(reader.run('stuck', url)).rejects.toThrow('reader-closed');
      const queued = expect(reader.run('queued', url)).rejects.toThrow('reader-closed');
      // Let the active request enter its thread before closing the pool.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await reader.close();
      await Promise.all([active, queued]);
    } finally {
      await reader.close();
    }
  });

  it('falls back to metadata only on a Reader timeout so the capture settles', async () => {
    const reader = pool();
    const spy = vi
      .spyOn(readerWorker, 'extractPage')
      .mockImplementation(() => reader.run('stuck', url));
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await extract({
        url,
        contentType: 'text/html',
        html: '<title>Saved title</title>',
      });
      expect(result).toMatchObject({ title: 'Saved title' });
      expect(result.reader).toBeUndefined();
      expect(log).toHaveBeenCalledWith('[reader] extraction unavailable', 'reader-timeout');
    } finally {
      spy.mockRestore();
      log.mockRestore();
      await reader.close();
    }
  });

  it('bounds startup separately when a thread never becomes ready', async () => {
    const reader = new readerWorker.ReaderPool({
      timeoutMs: 5_000,
      startupTimeoutMs: 100,
      entry: new URL('../test-support/stuck-transform.mjs', import.meta.url),
    });
    try {
      await expect(reader.run('', url)).rejects.toThrow('reader-startup-timeout');
    } finally {
      await reader.close();
    }
  });

  it('loads the real thread graph and extracts without DATABASE_URL', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await readerWorker.closeReaderPool();
      const result = await extract({
        url,
        contentType: 'text/html',
        html: '<title>No database</title><article><p>Database-free extraction.</p></article>',
      });
      expect(result.title).toBe('No database');
      expect(result.text).toBe('Database-free extraction.');
      expect(result.reader?.contentHtml).toContain('Database-free extraction.');
    } finally {
      await readerWorker.closeReaderPool();
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });
});

it('terminates rendered sanitization when the browser deadline aborts and restores the CPU queue', async () => {
  const reader = pool();
  const controller = new AbortController();
  try {
    const first = await reader.run('warm', url);
    const cancelled = expect(reader.sanitize('stuck', url, controller.signal)).rejects.toThrow(
      'reader-cancelled',
    );
    const next = reader.run('next', url);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await cancelled;
    const replacement = await next;
    expect(replacement.text?.split(':')[0]).not.toBe(first.text?.split(':')[0]);
    expect(replacement.text).toMatch(/:1:next$/);
  } finally {
    await reader.close();
  }
});

it('sanitizes rendered content in the real CPU thread without executing publisher scripts', async () => {
  try {
    const result = await readerWorker.sanitizeRenderedPage(
      '<p>Hello <a href="/next">reader</a>.</p><script>throw new Error("publisher script")</script><img src="/photo.png" onerror="attack()">',
      url,
      new AbortController().signal,
    );
    expect(result.text).toBe('Hello reader.');
    expect(result.reader?.contentHtml).toContain('https://journal.example.org/next');
    expect(result.reader?.contentHtml).not.toContain('script');
    expect(result.reader?.contentHtml).not.toContain('onerror');
  } finally {
    await readerWorker.closeReaderPool();
  }
});
