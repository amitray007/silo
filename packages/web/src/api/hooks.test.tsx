import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import {
  queryKeys,
  useCaptureLink,
  useCounts,
  useInfiniteLinks,
  useSearchLinks,
  useTags,
} from './hooks';
import type { LinksResponse } from './types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('queryKeys', () => {
  it('builds stable, distinct keys for later invalidation', () => {
    expect(queryKeys.counts()).toEqual(['counts']);
    expect(queryKeys.tags()).toEqual(['tags']);
    expect(queryKeys.links({ tag: 'mcp' })).toEqual(['links', { tag: 'mcp' }]);
    expect(queryKeys.links()).toEqual(['links', {}]);
    expect(queryKeys.link('abc')).toEqual(['link', 'abc']);
  });
});

describe('useCounts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes from loading to success with the counts payload', async () => {
    const counts = { live: 12, trash: 3, purgeWindowDays: 30 };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(counts));

    const { result } = renderHook(() => useCounts(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(counts);
    expect(fetch).toHaveBeenCalledWith('/api/counts');
  });

  it('surfaces an error state when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    const { result } = renderHook(() => useCounts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 500, error: 'internal_error' });
  });
});

describe('useTags', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes from loading to success with the tags payload', async () => {
    const tags = {
      tags: [
        { name: 'mcp', count: 4 },
        { name: 'essays', count: 2 },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(tags));

    const { result } = renderHook(() => useTags(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(tags);
    expect(fetch).toHaveBeenCalledWith('/api/tags');
  });
});

describe('useInfiniteLinks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('advances through pages via the opaque cursor and stops when nextCursor is absent', async () => {
    const page1 = { links: [{ id: '1' }], nextCursor: 'cursor-abc' };
    const page2 = { links: [{ id: '2' }] };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toEqual([page1]);
    expect(result.current.hasNextPage).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/links');

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toEqual([page1, page2]));
    expect(fetch).toHaveBeenCalledWith('/api/links?cursor=cursor-abc');
    expect(result.current.hasNextPage).toBe(false);
  });

  it('goes from loading to success with the first page', async () => {
    const page1 = { links: [{ id: '1' }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(page1));

    const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toEqual([page1]);
  });

  it('surfaces an error state when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 500, error: 'internal_error' });
  });

  it('scopes the request to ?tag= when a tag is passed (plan 011, V3-2 /tags/:name filtering)', async () => {
    const page1 = { links: [{ id: '1' }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(page1));

    const { result } = renderHook(() => useInfiniteLinks('mcp'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp');
  });

  it('combines ?tag= and ?cursor= on a subsequent page', async () => {
    const page1 = { links: [{ id: '1' }], nextCursor: 'cursor-abc' };
    const page2 = { links: [{ id: '2' }] };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    const { result } = renderHook(() => useInfiniteLinks('mcp'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp&cursor=cursor-abc');
  });

  it('a differently-tagged call uses a distinct cache key (fetches independently)', async () => {
    const responseA = { links: [{ id: 'a' }] };
    const responseB = { links: [] as unknown[] };
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(responseA))
      .mockResolvedValueOnce(jsonResponse(responseB));

    const { result: resultA } = renderHook(() => useInfiniteLinks('mcp'), { wrapper });
    const { result: resultB } = renderHook(() => useInfiniteLinks('ai'), { wrapper });

    await waitFor(() => expect(resultA.current.isSuccess).toBe(true));
    await waitFor(() => expect(resultB.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp');
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=ai');
  });
});

describe('useSearchLinks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and returns results for a non-empty query', async () => {
    const response = { results: [{ id: '1', rank: 0.5 }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useSearchLinks('typescript'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=typescript');
  });

  it('is disabled (never fetches) for an empty/blank query', () => {
    renderHook(() => useSearchLinks('   '), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trims the query before both the request and the cache key', async () => {
    const response = { results: [] as unknown[] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useSearchLinks('  hooks  '), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=hooks');
  });

  it('an empty result set resolves cleanly (the "nothing found" case)', async () => {
    const response = { results: [] as unknown[] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useSearchLinks('nosuchtermxyz'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });

  it('re-enables and fetches when the query goes from blank to non-blank', async () => {
    const response = { results: [{ id: '1', rank: 1 }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result, rerender } = renderHook(({ q }) => useSearchLinks(q), {
      wrapper,
      initialProps: { q: '' },
    });
    expect(fetch).not.toHaveBeenCalled();

    rerender({ q: 'typescript' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=typescript');
  });
});

describe('useCaptureLink', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Like the module-level `wrapper`, but returns the `QueryClient` too so a test can inspect/seed its cache directly. */
  function makeWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function CaptureWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { queryClient, CaptureWrapper };
  }

  it('POSTs to /api/links with the given url/tags', async () => {
    const { CaptureWrapper } = makeWrapper();
    const created = makeLink({ id: 'server-1', url: 'https://example.com' });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: created, deduped: false }, 201));

    const { result } = renderHook(() => useCaptureLink(), { wrapper: CaptureWrapper });

    await act(async () => {
      await result.current.mutateAsync({ url: 'https://example.com', tags: ['mcp'] });
    });

    expect(fetch).toHaveBeenCalledWith('/api/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', tags: ['mcp'] }),
    });
  });

  it('optimistically prepends a placeholder row to the untagged links cache before the server responds', async () => {
    const { queryClient, CaptureWrapper } = makeWrapper();
    const existing: LinksResponse = { links: [makeLink({ id: 'existing' })] };
    queryClient.setQueryData(queryKeys.links(), {
      pages: [existing],
      pageParams: [undefined],
    });

    // Never resolves during this assertion window — lets us inspect the optimistic (pre-response) state.
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useCaptureLink(), { wrapper: CaptureWrapper });

    act(() => {
      result.current.mutate({ url: 'https://new-example.com' });
    });

    await waitFor(() => {
      const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
      expect(cache?.pages[0]?.links).toHaveLength(2);
    });
    const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
    const optimisticLink = cache?.pages[0]?.links[0];
    expect(optimisticLink?.url).toBe('https://new-example.com');
    expect(optimisticLink?.captureStatus).toBe('enriching');
    // The pre-existing row is still there, just pushed down.
    expect(cache?.pages[0]?.links[1]?.id).toBe('existing');
  });

  it('rolls back the optimistic insert on a failed capture', async () => {
    const { queryClient, CaptureWrapper } = makeWrapper();
    const existing: LinksResponse = { links: [makeLink({ id: 'existing' })] };
    queryClient.setQueryData(queryKeys.links(), {
      pages: [existing],
      pageParams: [undefined],
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_url', message: 'Not a valid http(s) URL' }, 400),
    );

    const { result } = renderHook(() => useCaptureLink(), { wrapper: CaptureWrapper });

    await act(async () => {
      await result.current.mutateAsync({ url: 'not-a-url' }).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
    // Rolled back to exactly the pre-mutation snapshot — no optimistic row left behind.
    expect(cache?.pages).toEqual([existing]);
  });

  it('one capture failing does not roll back a DIFFERENT still-in-flight capture (id-scoped rollback, not snapshot-restore)', async () => {
    const { queryClient, CaptureWrapper } = makeWrapper();
    queryClient.setQueryData(queryKeys.links(), {
      pages: [{ links: [] } satisfies LinksResponse],
      pageParams: [undefined],
    });

    let resolveSecond!: (value: Response) => void;
    vi.mocked(fetch)
      // A fails immediately.
      .mockResolvedValueOnce(
        jsonResponse({ error: 'invalid_url', message: 'Not a valid http(s) URL' }, 400),
      )
      // B stays in flight while A's rollback runs.
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(() => useCaptureLink(), { wrapper: CaptureWrapper });

    act(() => {
      result.current.mutate({ url: 'not-a-url' }); // A
    });
    act(() => {
      result.current.mutate({ url: 'https://two.example.com' }); // B
    });

    // A's rollback has run (its placeholder is gone); B's placeholder must still be present.
    await waitFor(() => {
      const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
      const urls = cache?.pages[0]?.links.map((l) => l.url) ?? [];
      expect(urls).toEqual(['https://two.example.com']);
    });

    resolveSecond(jsonResponse({ link: makeLink({ id: 's2' }), deduped: false }, 201));
  });

  it('invalidates links/counts/tags on settle (success), reconciling with the server (dedup-safe)', async () => {
    const { queryClient, CaptureWrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const created = makeLink({ id: 'server-1', url: 'https://example.com' });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: created, deduped: true }, 201));

    const { result } = renderHook(() => useCaptureLink(), { wrapper: CaptureWrapper });

    await act(async () => {
      await result.current.mutateAsync({ url: 'https://example.com' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
    expect(invalidatedKeys).toContainEqual(['links']);
  });

  it('two concurrent captures both land as optimistic rows without stomping each other', async () => {
    const { queryClient, CaptureWrapper } = makeWrapper();
    queryClient.setQueryData(queryKeys.links(), {
      pages: [{ links: [] } satisfies LinksResponse],
      pageParams: [undefined],
    });

    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(() => useCaptureLink(), { wrapper: CaptureWrapper });

    act(() => {
      result.current.mutate({ url: 'https://one.example.com' });
    });
    act(() => {
      result.current.mutate({ url: 'https://two.example.com' });
    });

    await waitFor(() => {
      const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
      expect(cache?.pages[0]?.links).toHaveLength(2);
    });

    resolveFirst(jsonResponse({ link: makeLink({ id: 's1' }), deduped: false }, 201));
    resolveSecond(jsonResponse({ link: makeLink({ id: 's2' }), deduped: false }, 201));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
