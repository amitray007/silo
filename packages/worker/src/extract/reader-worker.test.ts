import { describe, expect, it, vi } from 'vitest';
import { extract } from './extract.js';
import { READER_BASE_TIMEOUT_MS, readerTimeoutMs } from './reader-limits.js';
import * as readerWorker from './reader-worker.js';

const entry = new URL('../test-support/reader-thread.mjs', import.meta.url);
const url = 'https://journal.example.org/';

function pool() {
  return new readerWorker.ReaderPool({ size: 1, timeoutMs: 150, startupTimeoutMs: 3_000, entry });
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
      size: 1,
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

describe('Reader thread warmth', () => {
  // The test thread needs 250ms before it is ready, so a cold start is always slower than this.
  const warmMs = 200;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

  async function timed<T>(promise: Promise<T>): Promise<{ value: T; ms: number }> {
    const started = Date.now();
    const value = await promise;
    return { value, ms: Date.now() - started };
  }

  it('prewarms a thread so the first page does not pay the cold start', async () => {
    const reader = pool();
    try {
      await reader.prewarm();
      const first = await timed(reader.run('first', url));
      expect(first.ms).toBeLessThan(warmMs);
      expect(first.value.text).toMatch(/:1:first$/);
    } finally {
      await reader.close();
    }
  });

  it('prewarm is a no-op while a thread already exists and shares one thread with the page', async () => {
    const reader = pool();
    try {
      const first = reader.run('first', url);
      reader.prewarm();
      reader.prewarm();
      const [a, b] = [await first, await reader.run('second', url)];
      expect(a.text?.split(':')[0]).toBe(b.text?.split(':')[0]);
      expect(b.text).toMatch(/:2:second$/);
    } finally {
      await reader.close();
    }
  });

  it('respawns in the background after a timeout so the next page finds a warm thread', async () => {
    const reader = pool();
    try {
      const first = await reader.run('first', url);
      await expect(reader.run('stuck', url)).rejects.toThrow('reader-timeout');
      await reader.prewarm();
      const next = await timed(reader.run('next', url));
      expect(next.ms).toBeLessThan(warmMs);
      expect(next.value.text?.split(':')[0]).not.toBe(first.text?.split(':')[0]);
      expect(next.value.text).toMatch(/:1:next$/);
    } finally {
      await reader.close();
    }
  });

  it('respawns after a crashed thread', async () => {
    const reader = pool();
    try {
      await expect(reader.run('exit', url)).rejects.toThrow('reader-exited');
      await reader.prewarm();
      expect((await timed(reader.run('after', url))).ms).toBeLessThan(warmMs);
    } finally {
      await reader.close();
    }
  });

  it('does not respawn into a closed pool, and close() cancels a respawn in progress', async () => {
    const reader = pool();
    await expect(reader.run('stuck', url)).rejects.toThrow('reader-timeout');
    const started = Date.now();
    await reader.close();
    expect(Date.now() - started).toBeLessThan(1_000);
    await expect(reader.run('late', url)).rejects.toThrow('reader-closed');
    reader.prewarm();
    await settle();
    await expect(reader.run('later', url)).rejects.toThrow('reader-closed');
  });

  it('leaves a failed startup to the next page instead of retrying in the background', async () => {
    const reader = new readerWorker.ReaderPool({
      size: 1,
      timeoutMs: 150,
      startupTimeoutMs: 100,
      entry: new URL('../test-support/stuck-transform.mjs', import.meta.url),
    });
    try {
      reader.prewarm();
      await settle();
      await expect(reader.run('page', url)).rejects.toThrow('reader-startup-timeout');
    } finally {
      await reader.close();
    }
  });
});

describe('Reader thread pool', () => {
  const threadOf = (result: { text?: string }) => result.text?.split(':')[0];
  const pages = (size: number, timeoutMs = 400) =>
    new readerWorker.ReaderPool({ size, timeoutMs, startupTimeoutMs: 3_000, entry });

  it('spreads concurrent pages over idle threads and never runs more threads than its size', async () => {
    const reader = pages(3, 3_000);
    try {
      const first = await Promise.all(['a', 'b', 'c'].map((id) => reader.run(id, url)));
      expect(new Set(first.map(threadOf)).size).toBe(3);
      const more = await Promise.all(
        Array.from({ length: 9 }, (_, i) => reader.run(`slow-${i}`, url)),
      );
      expect(new Set([...first, ...more].map(threadOf)).size).toBe(3);
    } finally {
      await reader.close();
    }
  });

  it('gives a thread one page at a time and serves waiting pages first come, first served', async () => {
    const reader = pages(2, 3_000);
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => reader.run(`slow-${i}`, url)),
      );
      // `title` is how many pages the thread already held when the page arrived.
      expect(results.map((result) => result.title)).toEqual(Array(8).fill('0'));
      const order = new Map<string | undefined, number[]>();
      for (const result of results) {
        const id = Number(result.text?.split('slow-')[1]);
        order.set(threadOf(result), [...(order.get(threadOf(result)) ?? []), id]);
      }
      for (const served of order.values())
        expect(served).toEqual([...served].sort((a, b) => a - b));
      // The first two pages go out together; every later page waits for one of them.
      expect(results.slice(0, 2).map((result) => result.text?.split(':')[1])).toEqual(['1', '1']);
    } finally {
      await reader.close();
    }
  });

  it('kills and replaces only the thread whose page timed out', async () => {
    const reader = pages(2);
    try {
      const [a, b] = await Promise.all([reader.run('a', url), reader.run('b', url)]);
      const stuck = expect(reader.run('stuck', url)).rejects.toThrow('reader-timeout');
      // The other thread keeps serving while the stuck one runs to its deadline.
      const during = await reader.run('during', url);
      await stuck;
      expect([threadOf(a), threadOf(b)]).toContain(threadOf(during));
      await reader.prewarm();
      const after = await Promise.all([reader.run('x', url), reader.run('y', url)]);
      // Both threads are warm again: the survivor plus one replacement, none started cold.
      expect(new Set(after.map(threadOf)).size).toBe(2);
      expect(
        after.filter((result) => ![threadOf(a), threadOf(b)].includes(threadOf(result))),
      ).toHaveLength(1);
    } finally {
      await reader.close();
    }
  });

  it('prewarms every thread so a burst finds them all warm', async () => {
    const reader = pages(3, 3_000);
    try {
      void reader.prewarm();
      await reader.prewarm();
      const started = Date.now();
      const results = await Promise.all(['a', 'b', 'c'].map((id) => reader.run(id, url)));
      // A cold start takes at least 250ms, so warm threads answer well under it.
      expect(Date.now() - started).toBeLessThan(200);
      expect(new Set(results.map(threadOf)).size).toBe(3);
      expect(results.map((result) => result.text?.split(':')[1])).toEqual(['1', '1', '1']);
    } finally {
      await reader.close();
    }
  });

  it('closes active and queued pages on every thread', async () => {
    const reader = pages(2, 3_000);
    const outcomes = ['stuck', 'stuck', 'queued-1', 'queued-2'].map((id) =>
      expect(reader.run(id, url)).rejects.toThrow('reader-closed'),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await reader.close();
    await Promise.all(outcomes);
    await expect(reader.run('late', url)).rejects.toThrow('reader-closed');
  });

  it('drops a queued rendered page when its browser deadline aborts, without using a thread', async () => {
    const reader = pages(1, 3_000);
    const controller = new AbortController();
    try {
      const busy = reader.run('slow-0', url);
      const cancelled = expect(reader.sanitize('queued', url, controller.signal)).rejects.toThrow(
        'stop',
      );
      controller.abort(new Error('stop'));
      await cancelled;
      expect(threadOf(await busy)).toBeDefined();
      // The aborted page never reached the thread: the next page is its second.
      expect((await reader.run('next', url)).text).toMatch(/:2:next$/);
    } finally {
      await reader.close();
    }
  });

  it('gives each page the size-scaled deadline unless a fixed one is set', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const reader = new readerWorker.ReaderPool({ size: 1, startupTimeoutMs: 3_000, entry });
    try {
      const html = '<i></i>'.repeat(4_000);
      await reader.run(html, url);
      expect(readerTimeoutMs(html)).toBeGreaterThan(READER_BASE_TIMEOUT_MS + 3_000);
      expect(timer.mock.calls.map(([, delay]) => delay)).toContain(readerTimeoutMs(html));
    } finally {
      timer.mockRestore();
      await reader.close();
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
