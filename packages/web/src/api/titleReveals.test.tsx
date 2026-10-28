import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTitleReveal, registerTitleReveal } from '../lib/titleReveals';
import { useTitleReveal } from '../lib/useTitleReveal';
import { makeLink } from '../test/fixtures';
import { queryKeys, useCaptureLink, useEditLink, useRetryCapture } from './hooks';
import type { LinkJson, LinksResponse } from './types';

function response(link: LinkJson, deduped = false) {
  return new Response(JSON.stringify({ link, deduped }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(link?: LinkJson) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.links(), {
    pages: [{ links: link ? [link] : [] }],
    pageParams: [undefined],
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper };
}

describe('mutation title reveal provenance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reveals fast enrichment across the optimistic-to-server React key swap', async () => {
    const { client, wrapper } = setup();
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const capture = renderHook(() => useCaptureLink(), { wrapper });
    let saved!: Promise<unknown>;
    await act(async () => {
      saved = capture.result.current.mutateAsync({ url: 'https://example.com' });
    });
    const temp = client.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links())?.pages[0]
      ?.links[0];
    if (!temp) throw new Error('Missing optimistic row');
    expect(getTitleReveal(temp.id)?.kind).toBe('pending');
    const optimistic = renderHook(() => useTitleReveal(temp));
    expect(optimistic.result.current).toBe(false);
    const server = makeLink({
      id: 'fast-server',
      title: 'Already enriched',
      captureStatus: 'full',
    });
    await act(async () => {
      resolve(response(server));
      await saved;
    });
    expect(getTitleReveal(temp.id)).toBeUndefined();
    optimistic.unmount();
    const settled = renderHook(() => useTitleReveal(server));
    expect(settled.result.current).toBe(true);
    expect(getTitleReveal(server.id)).toBeUndefined();
    settled.unmount();
    expect(renderHook(() => useTitleReveal(server)).result.current).toBe(false);
  });

  it('reveals a changed dedup title while its status stays full', async () => {
    const old = makeLink({ id: 'dedup-reveal', title: 'Old saved title', captureStatus: 'full' });
    const { wrapper } = setup(old);
    const row = renderHook(({ link }) => useTitleReveal(link), { initialProps: { link: old } });
    const capture = renderHook(() => useCaptureLink(), { wrapper });
    vi.mocked(fetch).mockResolvedValueOnce(response(old, true));
    await act(async () => {
      await capture.result.current.mutateAsync({ url: old.url });
    });
    // The unchanged save response must not consume the queued enrichment.
    row.rerender({ link: { ...old } });
    expect(row.result.current).toBe(false);
    expect(getTitleReveal(old.id)?.kind).toBe('pending');
    row.rerender({ link: { ...old, title: 'Fresh dedup title' } });
    expect(row.result.current).toBe(true);
    expect(getTitleReveal(old.id)).toBeUndefined();
  });

  it('never reveals an owner edit of a URL placeholder, including a late capture response', async () => {
    const old = makeLink({
      id: 'owner-reveal',
      title: 'https://example.com',
      captureStatus: 'full',
    });
    const { wrapper } = setup(old);
    const row = renderHook(({ link }) => useTitleReveal(link), { initialProps: { link: old } });
    const capture = renderHook(() => useCaptureLink(), { wrapper });
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let saved!: Promise<unknown>;
    await act(async () => {
      saved = capture.result.current.mutateAsync({ url: old.url });
    });
    registerTitleReveal(old.id, old.title ?? old.url);
    const edit = renderHook(() => useEditLink(old.id), { wrapper });
    const edited = { ...old, title: 'Owner title' };
    vi.mocked(fetch).mockResolvedValueOnce(response(edited));
    await act(async () => {
      await edit.result.current.mutateAsync({ title: edited.title });
    });
    row.rerender({ link: edited });
    expect(row.result.current).toBe(false);
    await act(async () => {
      resolve(response(edited, true));
      await saved;
    });
    row.rerender({ link: { ...edited } });
    expect(row.result.current).toBe(false);
    expect(getTitleReveal(old.id)?.kind).toBe('edit');
  });

  it.each(['New enriched title', 'Original'])('Enrich settles once with %s', async (title) => {
    const old = makeLink({ id: `retry-reveal-${title}`, title: 'Original', captureStatus: 'full' });
    const { wrapper } = setup(old);
    const row = renderHook(({ link }) => useTitleReveal(link), { initialProps: { link: old } });
    const retry = renderHook(() => useRetryCapture(old.id), { wrapper });
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...old, captureStatus: 'enriching' }));
    await act(async () => {
      await retry.result.current.mutateAsync();
    });
    row.rerender({ link: { ...old, captureStatus: 'enriching' } });
    expect(row.result.current).toBe(false);
    row.rerender({ link: { ...old, title } });
    expect(row.result.current).toBe(title !== 'Original');
    expect(getTitleReveal(old.id)).toBeUndefined();
  });

  it('removes the pending reveal after a failed capture or retry', async () => {
    const old = makeLink({ id: 'failed-retry', title: 'Original' });
    const { client, wrapper } = setup(old);
    const retry = renderHook(() => useRetryCapture(old.id), { wrapper });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
    await act(async () => {
      await expect(retry.result.current.mutateAsync()).rejects.toThrow('Offline');
    });
    expect(getTitleReveal(old.id)).toBeUndefined();
    const capture = renderHook(() => useCaptureLink(), { wrapper });
    let reject!: (error: Error) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    let saved!: Promise<unknown>;
    await act(async () => {
      saved = capture.result.current.mutateAsync({ url: old.url });
    });
    const temp = client.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links())?.pages[0]
      ?.links[0];
    if (!temp) throw new Error('Missing optimistic row');
    await act(async () => {
      reject(new Error('Offline'));
      await expect(saved).rejects.toThrow('Offline');
    });
    expect(getTitleReveal(temp.id)).toBeUndefined();
  });
});
