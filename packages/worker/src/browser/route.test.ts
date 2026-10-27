import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeFetchBytes } from '../fetch/safe-fetch.js';
import { BROWSER_USER_AGENT, browserAccept } from './profile.js';
import { BrowserRoutes, type RoutePort } from './route.js';

function route(url = 'https://example.org/a', type = 'document', method = 'GET') {
  return {
    request: () => ({ url: () => url, resourceType: () => type, method: () => method }),
    abort: vi.fn(async () => {}),
    fulfill: vi.fn(async (_response: Parameters<RoutePort['fulfill']>[0]) => {}),
  };
}
const response = (length: number) => ({
  ok: true as const,
  bytes: new Uint8Array(length),
  status: 200,
  contentType: 'application/javascript',
  finalUrl: 'https://example.org/a',
});
afterEach(() => vi.useRealTimers());

describe('browser request boundary', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.org',
    'data:text/html,a',
    'javascript:alert(1)',
    'ws://example.org',
    'https://u:p@example.org',
  ])('aborts %s before fetching', async (url) => {
    const fetch = vi.fn(async () => response(1));
    const request = route(url);
    await new BrowserRoutes(new AbortController().signal, fetch).handle(request);
    expect(request.abort).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['image', 'media', 'font', 'websocket', 'eventsource', 'manifest', 'other', 'unknown'])(
    'aborts resource type %s',
    async (type) => {
      const fetch = vi.fn(async () => response(1));
      const request = route(undefined, type);
      await new BrowserRoutes(new AbortController().signal, fetch).handle(request);
      expect(request.abort).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])(
    'aborts method %s',
    async (method) => {
      const fetch = vi.fn(async () => response(1));
      const request = route(undefined, 'fetch', method);
      await new BrowserRoutes(new AbortController().signal, fetch).handle(request);
      expect(request.abort).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(['document', 'script', 'stylesheet', 'xhr', 'fetch'])(
    'proxies %s with status, content type and raw bytes only',
    async (type) => {
      const fetch = vi.fn(async () => ({
        ...response(3),
        status: 404,
        bytes: new Uint8Array([0, 255, 128]),
      }));
      const request = route(undefined, type);
      await new BrowserRoutes(new AbortController().signal, fetch).handle(request);
      expect(request.fulfill).toHaveBeenCalledWith({
        status: 404,
        headers: { 'content-type': 'application/javascript' },
        body: Buffer.from([0, 255, 128]),
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://example.org/a',
        expect.objectContaining({
          maxBodyBytes: 5 * 1024 * 1024,
          signal: expect.any(AbortSignal),
          userAgent: BROWSER_USER_AGENT,
          accept: browserAccept(type),
        }),
      );
    },
  );
  it.each(['http://127.0.0.1:1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/'])(
    'blocks unsafe target %s through the real SSRF fetch',
    async (url) => {
      const fetch = vi.fn(safeFetchBytes);
      const request = route(url);
      await new BrowserRoutes(new AbortController().signal, fetch).handle(request);
      expect(await fetch.mock.results[0]?.value).toMatchObject({ ok: false, reason: 'blocked-ip' });
      expect(request.abort).toHaveBeenCalledOnce();
      expect(request.fulfill).not.toHaveBeenCalled();
    },
  );
  it('enforces 200 requests including rejected requests', async () => {
    const fetch = vi.fn(async () => response(1));
    const routes = new BrowserRoutes(new AbortController().signal, fetch);
    for (let i = 0; i < 199; i++) await routes.handle(route(undefined, 'image'));
    const last = route();
    await routes.handle(last);
    const over = route();
    await routes.handle(over);
    expect(last.fulfill).toHaveBeenCalledOnce();
    expect(over.abort).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('caps fulfilled bytes at 20 MB under concurrent requests', async () => {
    const routes = new BrowserRoutes(new AbortController().signal, async () =>
      response(5 * 1024 * 1024),
    );
    const requests = Array.from({ length: 8 }, () => route());
    await Promise.all(requests.map(routes.handle));
    expect(requests.filter((request) => request.fulfill.mock.calls.length)).toHaveLength(4);
    expect(requests.filter((request) => request.abort.mock.calls.length)).toHaveLength(4);
  });
  it('rejects oversized responses, aborted fetches and exceptions', async () => {
    for (const fetch of [
      async () => response(5 * 1024 * 1024 + 1),
      async () => {
        throw new Error('offline');
      },
    ]) {
      const request = route();
      await new BrowserRoutes(new AbortController().signal, fetch).handle(request);
      expect(request.abort).toHaveBeenCalledOnce();
      expect(request.fulfill).not.toHaveBeenCalled();
    }
    const controller = new AbortController();
    const fetch = vi.fn(async () => response(1));
    controller.abort();
    const request = route();
    await new BrowserRoutes(controller.signal, fetch).handle(request);
    expect(request.abort).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('settles after 800 ms of quiet, but caps the wait at 6 seconds', async () => {
    vi.useFakeTimers();
    const routes = new BrowserRoutes(new AbortController().signal, async () => response(1));
    const settled = vi.fn();
    await vi.advanceTimersByTimeAsync(2000);
    const quiet = routes.settle().then(settled);
    await vi.advanceTimersByTimeAsync(799);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await quiet;
    expect(settled).toHaveBeenCalledOnce();
    const busy = new BrowserRoutes(new AbortController().signal, () => new Promise(() => {}));
    void busy.handle(route());
    const capped = busy.settle().then(settled);
    await vi.advanceTimersByTimeAsync(6_000);
    await capped;
    expect(settled).toHaveBeenCalledTimes(2);
  });
});
