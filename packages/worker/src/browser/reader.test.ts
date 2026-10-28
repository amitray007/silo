import { chromium } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeReaderPool } from '../extract/reader-worker.js';
import { type BrowserPort, type ContextPort, type PagePort, renderPage } from './page.js';
import { BrowserReader, closeBrowserReader, renderReader } from './reader.js';

function fakeBrowser() {
  const page: PagePort = {
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async (expression: string) =>
      expression.includes('new Defuddle')
        ? { content: '<p>Rendered article with useful text.</p>', wordCount: 6 }
        : false,
    ),
  };
  const contexts: ContextPort[] = [];
  const disconnects: Array<() => void> = [];
  let connected = true;
  const browser: BrowserPort = {
    newContext: vi.fn(async () => {
      const context: ContextPort = {
        on: vi.fn(),
        route: vi.fn(async () => {}),
        routeWebSocket: vi.fn(async () => {}),
        newPage: async () => page,
        close: vi.fn(async () => {}),
      };
      contexts.push(context);
      return context;
    }),
    isConnected: () => connected,
    on: (_event, callback) => disconnects.push(callback),
    close: vi.fn(async () => {
      connected = false;
      for (const callback of disconnects) callback();
    }),
  };
  return { browser, page, contexts };
}
afterEach(async () => {
  await closeBrowserReader();
  await closeReaderPool();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function advance<T>(promise: Promise<T>) {
  await vi.advanceTimersByTimeAsync(900);
  return promise;
}

describe('rendered Reader pool', () => {
  it('does no browser work when endpoint is unset', async () => {
    vi.stubEnv('SILO_BROWSER_WS_ENDPOINT', '');
    const connect = vi.spyOn(chromium, 'connect');
    try {
      expect(await renderReader('https://example.org/')).toBeUndefined();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });
  it('reuses one connection, runs FIFO, and creates and closes fresh contexts', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    const connect = vi.fn(async () => fake.browser);
    const reader = new BrowserReader('ws://browser/', { connect });
    try {
      const first = reader.run('https://example.org/first');
      const second = reader.run('https://example.org/second');
      const third = reader.run('https://example.org/third');
      expect((await advance(first))?.text).toBe('Rendered article with useful text.');
      expect((await advance(second))?.reader?.contentHtml).toContain('Rendered article');
      await advance(third);
      expect(connect).toHaveBeenCalledOnce();
      expect(fake.contexts).toHaveLength(3);
      for (const context of fake.contexts) expect(context.close).toHaveBeenCalledOnce();
      expect(fake.page.goto).toHaveBeenNthCalledWith(1, 'https://example.org/first', {
        waitUntil: 'domcontentloaded',
      });
      expect(fake.page.goto).toHaveBeenNthCalledWith(2, 'https://example.org/second', {
        waitUntil: 'domcontentloaded',
      });
      expect(fake.page.goto).toHaveBeenNthCalledWith(3, 'https://example.org/third', {
        waitUntil: 'domcontentloaded',
      });
      expect(fake.browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceWorkers: 'block',
          acceptDownloads: false,
          bypassCSP: false,
          locale: 'en-US',
          viewport: { width: 1280, height: 900 },
        }),
      );
    } finally {
      await reader.close();
    }
    expect(fake.browser.close).toHaveBeenCalledOnce();
  });
  it('enforces the hard deadline, closes the context and recovers the queue', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    vi.mocked(fake.page.goto).mockImplementationOnce(() => new Promise(() => {}));
    const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser });
    try {
      const stuck = reader.run('https://example.org/stuck');
      const next = reader.run('https://example.org/next');
      await vi.advanceTimersByTimeAsync(19_999);
      expect(fake.contexts[0]?.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await stuck).toEqual({ renderPending: true });
      expect(fake.contexts[0]?.close).toHaveBeenCalled();
      expect((await advance(next))?.reader).toBeDefined();
    } finally {
      await reader.close();
    }
  });
  it('bounds connection startup and closes a late connection', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    let finish: ((browser: BrowserPort) => void) | undefined;
    const reader = new BrowserReader('ws://browser/', {
      connect: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const result = reader.run('https://example.org/');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ renderPending: true });
    finish?.(fake.browser);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.browser.close).toHaveBeenCalledOnce();
    expect(fake.contexts).toHaveLength(0);
    await reader.close();
  });
  it('opens the circuit after three failures, logs once and retries after five minutes', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    vi.mocked(fake.page.goto).mockRejectedValue(new Error('Protocol error: disconnected'));
    const log = vi.fn();
    const connect = vi.fn(async () => fake.browser);
    const reader = new BrowserReader('ws://browser/', { connect, log });
    try {
      for (let i = 0; i < 3; i++)
        expect(await reader.run('https://example.org/')).toEqual({ renderPending: true });
      for (let i = 0; i < 4; i++)
        expect(await reader.run('https://example.org/')).toEqual({ renderPending: true });
      expect(fake.contexts).toHaveLength(3);
      expect(log).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
      expect(await reader.run('https://example.org/')).toEqual({ renderPending: true });
      expect(fake.contexts).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1);
      vi.mocked(fake.page.goto).mockResolvedValue(undefined);
      expect((await advance(reader.run('https://example.org/')))?.reader).toBeDefined();
      expect(fake.contexts).toHaveLength(4);
    } finally {
      await reader.close();
    }
  });
  it('resets consecutive failures on success and reconnects a dropped connection', async () => {
    vi.useFakeTimers();
    const first = fakeBrowser();
    const second = fakeBrowser();
    const connect = vi
      .fn(async () => first.browser)
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValue(second.browser);
    const reader = new BrowserReader('ws://browser/', { connect });
    try {
      vi.mocked(first.page.goto)
        .mockRejectedValueOnce(new Error('Protocol error: fail'))
        .mockRejectedValueOnce(new Error('Protocol error: fail'));
      await reader.run('https://example.org/');
      await reader.run('https://example.org/');
      expect((await advance(reader.run('https://example.org/')))?.reader).toBeDefined();
      await first.browser.close();
      expect((await advance(reader.run('https://example.org/')))?.reader).toBeDefined();
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      await reader.close();
    }
  });
  it.each([
    null,
    { content: 'x'.repeat(4 * 1024 * 1024 + 1), wordCount: 1 },
    { content: '<script>evil()</script>', wordCount: 1 },
  ])('falls back on empty or oversized results and closes the context', async (result) => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    vi.mocked(fake.page.evaluate).mockImplementation(async (expression) =>
      expression.includes('new Defuddle') ? result : false,
    );
    const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser });
    try {
      expect(await advance(reader.run('https://example.org/'))).toBeUndefined();
      expect(fake.contexts[0]?.close).toHaveBeenCalledOnce();
    } finally {
      await reader.close();
    }
  });
  it('rejects challenge pages before Defuddle and closes the context', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    vi.mocked(fake.page.evaluate).mockResolvedValue(true);
    const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser });
    try {
      expect(await advance(reader.run('https://example.org/'))).toBeUndefined();
      expect(fake.page.evaluate).toHaveBeenCalledTimes(1);
      expect(fake.contexts[0]?.close).toHaveBeenCalledOnce();
    } finally {
      await reader.close();
    }
  });
  it('installs HTTP and WebSocket routes before navigation', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    vi.mocked(fake.page.goto).mockImplementation(async () => {
      expect(fake.contexts[0]?.route).toHaveBeenCalledOnce();
      expect(fake.contexts[0]?.routeWebSocket).toHaveBeenCalledOnce();
    });
    await advance(renderPage(fake.browser, 'https://example.org/', new AbortController().signal));
  });
  it('proves the challenge rejection specifically', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    vi.mocked(fake.page.evaluate).mockResolvedValue(true);
    const work = expect(
      renderPage(fake.browser, 'https://example.org/', new AbortController().signal),
    ).rejects.toThrow('browser-challenge');
    await advance(work);
  });
  it.each(['navigation failed', 'browser-challenge', 'browser-content-limit'])(
    'does not open the circuit for page outcome %s',
    async (message) => {
      const fake = fakeBrowser();
      vi.mocked(fake.page.goto).mockRejectedValue(new Error(message));
      const log = vi.fn();
      const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser, log });
      for (let i = 0; i < 6; i++) expect(await reader.run('https://example.org/')).toBeUndefined();
      expect(fake.contexts).toHaveLength(6);
      expect(log).not.toHaveBeenCalled();
      await reader.close();
    },
  );
  it('reopens immediately after the one half-open trial fails', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async (): Promise<BrowserPort> => {
      throw new Error('offline');
    });
    const log = vi.fn();
    const reader = new BrowserReader('ws://browser/', { connect, log });
    for (let i = 0; i < 3; i++) await reader.run('https://example.org/');
    expect(connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const trials = Array.from({ length: 3 }, () => reader.run('https://example.org/'));
    await Promise.all(trials);
    expect(connect).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    await reader.run('https://example.org/');
    expect(connect).toHaveBeenCalledTimes(4);
    await reader.close();
  });
  it('treats a disconnect during rendering as infrastructure failure', async () => {
    const fake = fakeBrowser();
    vi.mocked(fake.page.goto).mockImplementation(() => new Promise(() => {}));
    const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser });
    const work = reader.run('https://example.org/');
    await vi.waitFor(() => expect(fake.page.goto).toHaveBeenCalled());
    await fake.browser.close();
    expect(await work).toEqual({ renderPending: true });
    await reader.close();
  });
  it('cancels queued callers immediately, frees capacity, and caps waiting work at ten', async () => {
    const fake = fakeBrowser();
    vi.mocked(fake.page.goto).mockImplementation(() => new Promise(() => {}));
    const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser });
    const active = reader.run('https://example.org/active');
    const controller = new AbortController();
    const cancelled = reader.run('https://example.org/cancelled', controller.signal);
    const queued = Array.from({ length: 9 }, () => reader.run('https://example.org/queued'));
    expect(await reader.run('https://example.org/overflow')).toBeUndefined();
    controller.abort();
    expect(await cancelled).toBeUndefined();
    const replacement = reader.run('https://example.org/replacement');
    await reader.close();
    await Promise.all([active, replacement, ...queued]);
    expect(fake.page.goto).not.toHaveBeenCalled();
  });
  it.each(['reject', 'stall'])(
    'bounds context cleanup on %s without losing a good result',
    async (mode) => {
      vi.useFakeTimers();
      const fake = fakeBrowser();
      const original = vi.mocked(fake.browser.newContext).getMockImplementation();
      if (!original) throw new Error('missing context factory');
      vi.mocked(fake.browser.newContext).mockImplementation(async (options) => {
        const context = await original(options);
        context.close = vi.fn(() =>
          mode === 'reject' ? Promise.reject(new Error('close')) : new Promise<void>(() => {}),
        );
        return context;
      });
      const work = renderPage(fake.browser, 'https://example.org/', new AbortController().signal);
      await vi.advanceTimersByTimeAsync(900);
      // Sanitizing starts a real worker thread; a slow CI runner can take over
      // vi.waitFor's 1s default before cleanup runs.
      await vi.waitFor(() => expect(fake.contexts[0]?.close).toHaveBeenCalled(), {
        timeout: 10_000,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await work).reader).toBeDefined();
    },
  );
  it('bounds browser shutdown even if its close hangs', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser });
    await advance(reader.run('https://example.org/'));
    vi.mocked(fake.browser.close).mockImplementation(() => new Promise(() => {}));
    const closed = vi.fn();
    const work = reader.close().then(closed);
    await vi.advanceTimersByTimeAsync(1_000);
    await work;
    expect(closed).toHaveBeenCalledOnce();
  });
  it('cancels queued and active pages during shutdown', async () => {
    const fake = fakeBrowser();
    vi.mocked(fake.page.goto).mockImplementation(() => new Promise(() => {}));
    const reader = new BrowserReader('ws://browser/', { connect: async () => fake.browser });
    const active = reader.run('https://example.org/');
    const queued = reader.run('https://example.org/');
    await vi.waitFor(() => expect(fake.page.goto).toHaveBeenCalled());
    await reader.close();
    expect(await active).toBeUndefined();
    expect(await queued).toBeUndefined();
    expect(fake.contexts).toHaveLength(1);
    expect(fake.contexts[0]?.close).toHaveBeenCalled();
  });
});
