import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSettings } from '../lib/settings.js';
import { queuePage, readPage, retryPages } from './page-outbox.js';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const page = {
  url: 'https://example.org/article',
  html: '<article>Body</article>',
  capturedAt: new Date().toISOString(),
};
describe('durable browser page outbox', () => {
  it('retries after service-worker module restart and removes successful entries', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    await queuePage('saved-id', page, 'http://localhost:8787');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.resetModules();
    fetch.mockResolvedValue(new Response(null, { status: 202 }));
    await (await import('./page-outbox.js')).retryPages();
    expect(fetch).toHaveBeenCalledTimes(2);
    await retryPages();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chrome.alarms.clear).toHaveBeenCalledWith('silo-page-outbox');
  });
  it.each([400, 401, 404, 413])('drops terminal HTTP %s', async (status) => {
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal('fetch', fetch);
    await queuePage('saved-id', page, 'http://localhost:8787');
    await retryPages();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([408, 429, 500])('retries HTTP %s only five times', async (status) => {
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal('fetch', fetch);
    await queuePage('saved-id', page, 'http://localhost:8787');
    for (let i = 0; i < 7; i++) await retryPages();
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it('drops pending HTML when the destination changes', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    await queuePage('saved-id', page, 'http://localhost:8787');
    await saveSettings({ baseUrl: 'https://different.example', token: 'new-token' });
    await retryPages();
    await retryPages();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses the current token for the same server', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    await queuePage('saved-id', page, 'http://localhost:8787');
    await saveSettings({ baseUrl: 'http://localhost:8787', token: 'rotated' });
    await retryPages();
    expect(fetch.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer rotated');
  });
  it('drops expired copies without uploading', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await queuePage(
      'saved-id',
      {
        ...page,
        capturedAt: new Date(Date.now() - 8 * 86400_000).toISOString(),
      },
      'http://localhost:8787',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('skips pages larger than nine serialized megabytes before returning a copy', async () => {
    const original = document.documentElement.innerHTML;
    document.body.textContent = 'x'.repeat(9 * 1024 * 1024);
    (chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (injection) => [{ result: injection.func() }],
    );
    try {
      expect(await readPage(12, location.href)).toBeUndefined();
    } finally {
      document.documentElement.innerHTML = original;
    }
  });
  it('skips quote-heavy HTML that exceeds nine MB after JSON escaping', async () => {
    const original = document.documentElement.innerHTML;
    document.body.textContent = '"'.repeat(5 * 1024 * 1024);
    (chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (injection) => [{ result: injection.func() }],
    );
    try {
      expect(await readPage(12, location.href)).toBeUndefined();
    } finally {
      document.documentElement.innerHTML = original;
    }
  });
  it('reruns an empty drain when a page is queued while its alarm clears', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    let release!: () => void;
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const clear = chrome.alarms.clear as unknown as ReturnType<typeof vi.fn>;
    clear.mockImplementationOnce(async () => {
      reached();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return true;
    });
    const draining = retryPages();
    await ready;
    const queued = queuePage('late-id', page, 'http://localhost:8787');
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([draining, queued]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const create = chrome.alarms.create as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      clear.mock.invocationCallOrder.at(-1) ?? 0,
    );
  });
  it('skips navigated pages and targets only the top frame', async () => {
    (chrome.scripting.executeScript as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { frameId: 0, result: page },
    ]);
    expect(await readPage(12, 'https://different.org/')).toBeUndefined();
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 12, frameIds: [0] }, injectImmediately: true }),
    );
  });
});
