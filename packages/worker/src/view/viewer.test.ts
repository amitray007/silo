import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { createPageViewer } from './viewer.js';

const viewers: ReturnType<typeof createPageViewer>[] = [];
const success = (extra = {}): SafeFetchResult => ({
  ok: true,
  html: '<h1>Page</h1>',
  contentType: 'text/html',
  finalUrl: 'https://publisher.test/redirected',
  status: 200,
  ...extra,
});
function setup(options: Parameters<typeof createPageViewer>[0] = {}) {
  const fetch = vi.fn(async () => success());
  const transform = vi.fn(async (html: string) => html);
  const viewer = createPageViewer({ fetch, transform, ...options });
  viewers.push(viewer);
  const request = (id = 'a', origin = 'https://silo.test', signal = new AbortController().signal) =>
    viewer.view({ id, url: `https://publisher.test/${id}`, origin, signal });
  return { ...viewer, request, fetch, transform };
}
afterEach(async () => {
  await Promise.all(viewers.splice(0).map((viewer) => viewer.close()));
});

describe('page viewer shared fetch', () => {
  it('coalesces a link and shares transformed output across frame/view requests', async () => {
    const { request, fetch, transform } = setup();
    const results = await Promise.all([request(), request(), request()]);
    expect(results[0]).toEqual({
      frame: { mode: 'direct', contentType: 'text/html' },
      html: '<h1>Page</h1>',
    });
    expect(results.every((r) => r.html === results[0]?.html)).toBe(true);
    await request();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledTimes(1);
  });
  it('refresh bypasses and replaces cache once per link per five seconds, coalescing both routes', async () => {
    const { view, request, fetch } = setup();
    await request();
    fetch.mockResolvedValue(success({ html: '<p>Fresh</p>' }));
    const fresh = () =>
      view({
        id: 'a',
        url: 'https://publisher.test/a',
        origin: 'https://silo.test',
        signal: new AbortController().signal,
        fresh: true,
      });
    const [a, b] = await Promise.all([fresh(), fresh()]);
    expect(a.html).toBe('<p>Fresh</p>');
    expect(b.html).toBe('<p>Fresh</p>');
    expect((await request()).html).toBe('<p>Fresh</p>');
    expect(fetch).toHaveBeenCalledTimes(2);
    await fresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_001);
    try {
      await fresh();
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });
  it('evaluates policy per request origin, from the same cached final response', async () => {
    const { request, fetch } = setup();
    fetch.mockResolvedValue(
      success({
        html: `<article>${'Article text. '.repeat(30)}</article>`,
        xFrameOptions: 'DENY',
        contentSecurityPolicy: 'frame-ancestors https://allowed.test:5175',
      }),
    );
    expect((await request('a', 'https://allowed.test:5175')).frame.mode).toBe('direct');
    expect((await request('a', 'https://allowed.test:5176')).frame.mode).toBe('view');
    expect((await request('a', 'https://silo.test')).frame.mode).toBe('view');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses needs-script for a thin transformed page, excluding page chrome', async () => {
    const { request } = setup({
      fetch: async () => success({ xFrameOptions: 'DENY' }),
      transform: async () => `<html><body><nav>${'Navigation '.repeat(50)}</nav>
        <header>${'Header '.repeat(50)}</header><aside>${'Sidebar '.repeat(50)}</aside>
        <footer>${'Footer '.repeat(50)}</footer><article>${'x'.repeat(50)}</article>
        <style>${'body{color:red}'.repeat(50)}</style></body></html>`,
    });
    expect((await request()).frame).toEqual({
      mode: 'none',
      reason: 'needs-script',
      contentType: 'text/html',
    });
  });
  it('keeps a blocked page with exactly 200 article characters in view mode', async () => {
    const { request } = setup({
      fetch: async () => success({ xFrameOptions: 'DENY' }),
      transform: async () => `<article>${'x'.repeat(200)}</article>`,
    });
    expect((await request()).frame.mode).toBe('view');
  });
  it('treats failure as none and blocked non-HTML as none; a frameable PDF is direct', async () => {
    const { request, fetch, transform } = setup();
    fetch.mockResolvedValueOnce({ ok: false, reason: 'blocked-ip' });
    expect((await request('bad')).frame).toEqual({ mode: 'none', reason: 'blocked-ip' });
    fetch.mockResolvedValueOnce(success({ contentType: 'application/pdf', xFrameOptions: 'DENY' }));
    expect((await request('pdf-blocked')).frame.mode).toBe('none');
    fetch.mockResolvedValueOnce(success({ contentType: 'application/pdf' }));
    expect((await request('pdf')).frame.mode).toBe('direct');
    expect(transform).not.toHaveBeenCalled();
  });
  it('uses none for non-displayable downloads', async () => {
    const { request, fetch } = setup();
    fetch.mockResolvedValue(success({ contentType: 'application/zip' }));
    expect((await request()).frame).toEqual({
      mode: 'none',
      reason: 'unsupported-content',
      contentType: 'application/zip',
    });
  });

  it('ignores meta frame-ancestors', async () => {
    const { request, fetch } = setup();
    fetch.mockResolvedValue(
      success({
        html: '<meta http-equiv="Content-Security-Policy" content="frame-ancestors none"><p>Page</p>',
      }),
    );
    expect((await request()).frame.mode).toBe('direct');
  });
  it('limits fetch plus transform to two active links and returns 503-class failure after a brief wait', async () => {
    let complete: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await blocked;
      active--;
      return success();
    });
    const { request } = setup({ fetch, waitMs: 30 });
    const first = request('a');
    const second = request('b');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await expect(request('c')).rejects.toThrow('Page viewer unavailable');
    expect(peak).toBe(2);
    complete?.();
    await Promise.all([first, second]);
    expect((await request('c')).frame.mode).toBe('direct');
  });
  it('lets a queued request start when a slot is released', async () => {
    let complete: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const fetch = vi.fn(async () => {
      await blocked;
      return success();
    });
    const { request } = setup({ fetch });
    const requests = [request('a'), request('b'), request('c')];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    complete?.();
    await Promise.all(requests);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('aborts the fetch when its last client disconnects, without canceling another subscriber', async () => {
    let upstream: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, signal: AbortSignal) => {
      upstream = signal;
      return new Promise<SafeFetchResult>((resolve) =>
        signal.addEventListener('abort', () => resolve({ ok: false, reason: 'timeout' }), {
          once: true,
        }),
      );
    });
    const { request } = setup({ fetch });
    const a = new AbortController();
    const b = new AbortController();
    const one = request('a', undefined, a.signal);
    const two = request('a', undefined, b.signal);
    await vi.waitFor(() => expect(upstream).toBeDefined());
    a.abort();
    await expect(one).rejects.toThrow('Page viewer unavailable');
    expect(upstream?.aborted).toBe(false);
    b.abort();
    await expect(two).rejects.toThrow('Page viewer unavailable');
    expect(upstream?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not cache aborted work, and never fetches a pre-aborted request', async () => {
    const { request, fetch } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(request('a', undefined, controller.signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect((await request()).html).toBeDefined();
  });
  it('expires cached results and refuses to retain output over the byte budget', async () => {
    const { request, fetch } = setup({ ttlMs: 5 });
    await request();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await request();
    expect(fetch).toHaveBeenCalledTimes(2);
    const small = setup({ cacheBytes: 1 });
    await small.request();
    await small.request();
    expect(small.fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps direct framing after a transform timeout and checks cached policy per origin', async () => {
    const { request, fetch } = setup({
      transform: async () => {
        throw new Error('transform-timeout');
      },
    });
    fetch.mockResolvedValue(
      success({ contentSecurityPolicy: 'frame-ancestors https://silo.test' }),
    );
    expect(await request()).toEqual({ frame: { mode: 'direct', contentType: 'text/html' } });
    expect((await request('a', 'https://blocked.test')).frame).toEqual({
      mode: 'none',
      reason: 'transform-unavailable',
      contentType: 'text/html',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns none when framing is blocked and the worker transform fails or times out', async () => {
    const { request } = setup({
      fetch: async () => success({ xFrameOptions: 'DENY' }),
      transform: async () => {
        throw new Error('transform-timeout');
      },
    });
    expect((await request()).frame).toEqual({
      mode: 'none',
      reason: 'transform-unavailable',
      contentType: 'text/html',
    });
  });
  it('does not reuse a cached page when the stored URL changes', async () => {
    const { view, request, fetch } = setup();
    await request();
    await view({
      id: 'a',
      url: 'https://other.test/',
      origin: 'https://silo.test',
      signal: new AbortController().signal,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('page viewer cancellation and transform occupancy', () => {
  it('holds both slots through transformation, and removes a disconnected waiter', async () => {
    let complete: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const transform = vi.fn(async (html: string) => {
      await blocked;
      return html;
    });
    const { request, fetch } = setup({ transform, waitMs: 30 });
    const a = request('a');
    const b = request('b');
    await vi.waitFor(() => expect(transform).toHaveBeenCalledTimes(2));
    const controller = new AbortController();
    const queued = request('queued', undefined, controller.signal);
    controller.abort();
    await expect(queued).rejects.toThrow('Page viewer unavailable');
    await expect(request('c')).rejects.toThrow('Page viewer unavailable');
    expect(fetch).toHaveBeenCalledTimes(2);
    complete?.();
    await Promise.all([a, b]);
    expect((await request('next')).frame.mode).toBe('direct');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
