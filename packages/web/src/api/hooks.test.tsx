import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink, makeTrashLink } from '../test/fixtures';
import {
  queryKeys,
  runBulk,
  useAddTag,
  useBulkDeleteNow,
  useBulkRestore,
  useBulkTrash,
  useCaptureLink,
  useCounts,
  useCreateTag,
  useDeleteNow,
  useEditLink,
  useEmptyTrash,
  useInfiniteLinks,
  useLinksByTag,
  useRemoveTag,
  useRestoreLink,
  useRetryCapture,
  useSearchLinks,
  useTags,
  useTrashLink,
  useTrashList,
} from './hooks';
import type { LinksResponse, TrashResponse } from './types';

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

  it('omits an explicit undefined filter field rather than hashing it in (cache-key hardening)', () => {
    // TanStack hashes keys structurally and does NOT strip an explicit
    // `undefined` — `{ tag: 'x', status: undefined }` would hash differently
    // from `{ tag: 'x' }` if spread verbatim, silently missing the cache.
    expect(queryKeys.links({ tag: 'x', status: undefined })).toEqual(queryKeys.links({ tag: 'x' }));
    expect(queryKeys.links({ tag: 'x', status: undefined })).toEqual(['links', { tag: 'x' }]);
    expect(queryKeys.links()).toEqual(['links', {}]);
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
    expect(fetch).toHaveBeenCalledWith('/api/counts', { credentials: 'include' });
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
    expect(fetch).toHaveBeenCalledWith('/api/tags', { credentials: 'include' });
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
    expect(fetch).toHaveBeenCalledWith('/api/links', { credentials: 'include' });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toEqual([page1, page2]));
    expect(fetch).toHaveBeenCalledWith('/api/links?cursor=cursor-abc', { credentials: 'include' });
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

  it('does NOT fetch when enabled: false (the command palette gates this per scope)', async () => {
    renderHook(() => useInfiniteLinks(undefined, { enabled: false }), { wrapper });
    // No await/waitFor for a fetch that must never happen — assert the query
    // stays idle and the network was never touched.
    expect(fetch).not.toHaveBeenCalled();
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
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp', { credentials: 'include' });
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

    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp&cursor=cursor-abc', {
      credentials: 'include',
    });
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
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=mcp', { credentials: 'include' });
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=ai', { credentials: 'include' });
  });

  /**
   * Smart polling (plan 014) — `refetchInterval`'s function form must poll
   * every 1500ms while ANY cached page holds an `enriching` row, and STOP
   * (no further `/api/links` calls) the instant every row has settled. Real
   * timers are used (not `vi.useFakeTimers()`) because TanStack Query's
   * internal poll scheduling doesn't reliably advance under fake timers in
   * this setup; the interval (1500ms) is short enough for a real-timer test
   * to stay fast while still proving the behavior end-to-end.
   */
  describe('smart polling (refetchInterval)', () => {
    it('polls again ~1.5s later while a cached link is still enriching', async () => {
      const enrichingPage = { links: [makeLink({ id: '1', captureStatus: 'enriching' })] };
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(enrichingPage))
        .mockResolvedValueOnce(jsonResponse(enrichingPage));

      const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(fetch).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    });

    it('stops polling once every cached link has settled to full', async () => {
      const fullPage = { links: [makeLink({ id: '1', captureStatus: 'full' })] };
      vi.mocked(fetch).mockResolvedValue(jsonResponse(fullPage));

      const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(fetch).toHaveBeenCalledTimes(1);

      // Give a full 1500ms+ window a chance to have fired a poll — it must not have.
      await new Promise((resolve) => setTimeout(resolve, 1800));
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('stops polling once a previously-enriching link across pages settles (multi-page cache)', async () => {
      const page1Enriching = { links: [makeLink({ id: '1', captureStatus: 'enriching' })] };
      const page1Full = { links: [makeLink({ id: '1', captureStatus: 'full' })] };
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(page1Enriching))
        .mockResolvedValue(jsonResponse(page1Full));

      const { result } = renderHook(() => useInfiniteLinks(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 3000 });

      // Now settled to full — no third poll should ever land.
      const callsAfterSettle = vi.mocked(fetch).mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 1800));
      expect(vi.mocked(fetch).mock.calls.length).toBe(callsAfterSettle);
    });
  });
});

describe('useLinksByTag', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is disabled (never fetches) when tag is undefined', () => {
    renderHook(() => useLinksByTag(undefined), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches GET /api/links?tag= for a given tag', async () => {
    const response = { links: [{ id: '1' }] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(response));

    const { result } = renderHook(() => useLinksByTag('frontend'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/links?tag=frontend', { credentials: 'include' });
    expect(result.current.data).toEqual(response);
  });

  it('uses a distinct query key from queryKeys.links({ tag }) (regression: cache-shape collision, plan 024 review)', () => {
    // useInfiniteLinks(tag) and useLinksByTag(tag) must NEVER key onto the
    // same cache entry — useInfiniteLinks writes InfiniteData<LinksResponse>
    // ({ pages, pageParams }), useLinksByTag writes a bare LinksResponse
    // ({ links, nextCursor }). Sharing a key means whichever resolves last
    // silently overwrites the other's shape, and a consumer reading
    // `data.pages` off the clobbered entry (e.g. useListView.ts) throws.
    expect(queryKeys.tagOnlyList('frontend')).not.toEqual(queryKeys.links({ tag: 'frontend' }));
  });

  it('mounting useInfiniteLinks(tag) and useLinksByTag(tag) together for the SAME tag does not corrupt either cache entry', async () => {
    // Both hooks hit the identical GET /api/links?tag=frontend URL, so the
    // response body is the same page either way — the regression this test
    // guards is about the CACHE KEY/SHAPE, not the payload content.
    const page: LinksResponse = { links: [makeLink({ id: 'shared-1' })] };
    // A fresh Response per call (not mockResolvedValue reusing one instance)
    // — both hooks fetch the identical URL concurrently, and a Response body
    // can only be consumed once (a shared instance would throw "Body is
    // unusable" on whichever hook reads it second).
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse(page)));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sharedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const infinite = renderHook(() => useInfiniteLinks('frontend'), { wrapper: sharedWrapper });
    const tagOnly = renderHook(() => useLinksByTag('frontend'), { wrapper: sharedWrapper });

    await waitFor(() => expect(infinite.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(tagOnly.result.current.isSuccess).toBe(true));

    // The infinite query's OWN cache entry (queryKeys.links({tag})) is
    // InfiniteData-shaped (has `pages`) — proves useLinksByTag's write never
    // landed on useInfiniteLinks's key and clobbered it into a bare
    // LinksResponse (the pre-fix crash: useListView.ts's `data?.pages.flatMap`
    // would throw on a clobbered entry).
    const infiniteCacheEntry = queryClient.getQueryData<{ pages?: unknown }>(
      queryKeys.links({ tag: 'frontend' }),
    );
    expect(infiniteCacheEntry?.pages).toBeDefined();
    expect(Array.isArray(infiniteCacheEntry?.pages)).toBe(true);

    // The tag-only query's OWN cache entry (queryKeys.tagOnlyList) is a bare
    // LinksResponse — no `pages` field, proves it never wrote INTO the
    // infinite query's key either.
    const tagOnlyCacheEntry = queryClient.getQueryData<{ pages?: unknown; links?: unknown }>(
      queryKeys.tagOnlyList('frontend'),
    );
    expect(tagOnlyCacheEntry?.pages).toBeUndefined();
    expect(tagOnlyCacheEntry?.links).toBeDefined();

    // Sanity: the two keys are genuinely distinct entries in the cache, not
    // the same object read twice.
    expect(queryKeys.links({ tag: 'frontend' })).not.toEqual(queryKeys.tagOnlyList('frontend'));
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
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=typescript', {
      credentials: 'include',
    });
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
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=hooks', { credentials: 'include' });
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
    expect(fetch).toHaveBeenCalledWith('/api/links/search?q=typescript', {
      credentials: 'include',
    });
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
      body: JSON.stringify({ url: 'https://example.com', tags: ['mcp'], source: 'web' }),
      credentials: 'include',
    });
  });

  it("stamps source: 'web' on the request body regardless of what the caller passed", async () => {
    const { CaptureWrapper } = makeWrapper();
    const created = makeLink({ id: 'server-2', url: 'https://example.com/b' });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: created, deduped: false }, 201));

    const { result } = renderHook(() => useCaptureLink(), { wrapper: CaptureWrapper });

    await act(async () => {
      await result.current.mutateAsync({ url: 'https://example.com/b' });
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.source).toBe('web');
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

  it('invalidates links/counts/tags on settle (success), reconciling with the server (dedup-safe) — without a redundant duplicate invalidate on the ["links", {}] subkey', async () => {
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
    // queryKeys.links() (= ['links', {}]) is a subkey the ['links'] prefix
    // invalidate above already covers — a separate call on it would be
    // fully redundant, so onSettled must not fire it.
    const linksInvalidateCalls = invalidateSpy.mock.calls.filter(
      (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(queryKeys.links()),
    );
    expect(linksInvalidateCalls).toHaveLength(0);
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

describe('useEditLink', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCHes only the given fields to /api/links/:id', async () => {
    const updated = makeLink({ id: '1', title: 'New title' });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: updated }, 200));

    const { result } = renderHook(() => useEditLink('1'), { wrapper });

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync({ title: 'New title' });
    });

    expect(fetch).toHaveBeenCalledWith('/api/links/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New title' }),
      credentials: 'include',
    });
    expect(response).toEqual({ link: updated });
  });

  it('invalidates links/link on settle, but NOT counts/tags (an edit never touches tag membership or live/trash counts)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function TestWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: makeLink({ id: '1' }) }, 200));

    const { result } = renderHook(() => useEditLink('1'), { wrapper: TestWrapper });

    await act(async () => {
      await result.current.mutateAsync({ description: 'new desc' });
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(['link']);
    expect(invalidatedKeys).not.toContainEqual(queryKeys.counts());
    expect(invalidatedKeys).not.toContainEqual(queryKeys.tags());
  });

  it('surfaces an error for a failed edit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'not_found', message: 'No live link with id 1' }, 404),
    );

    const { result } = renderHook(() => useEditLink('1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'x' }).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useTrashLink', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function TrashWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { queryClient, TrashWrapper };
  }

  it('POSTs to /api/links/:id/trash', async () => {
    const { TrashWrapper } = makeWrapper();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ link: makeLink({ id: '1', tags: [] }) }, 200),
    );

    const { result } = renderHook(() => useTrashLink('1'), { wrapper: TrashWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(fetch).toHaveBeenCalledWith('/api/links/1/trash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
  });

  it('optimistically removes the row from every cached links list before the server responds', async () => {
    const { queryClient, TrashWrapper } = makeWrapper();
    const existing: LinksResponse = {
      links: [makeLink({ id: 'target' }), makeLink({ id: 'keep' })],
    };
    queryClient.setQueryData(queryKeys.links(), { pages: [existing], pageParams: [undefined] });

    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useTrashLink('target'), { wrapper: TrashWrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
      expect(cache?.pages[0]?.links.map((l) => l.id)).toEqual(['keep']);
    });
  });

  it('restores the row from the pre-mutation snapshot if the trash call fails', async () => {
    const { queryClient, TrashWrapper } = makeWrapper();
    const existing: LinksResponse = { links: [makeLink({ id: 'target' })] };
    queryClient.setQueryData(queryKeys.links(), { pages: [existing], pageParams: [undefined] });

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'not_found', message: 'gone' }, 404),
    );

    const { result } = renderHook(() => useTrashLink('target'), { wrapper: TrashWrapper });

    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
    expect(cache?.pages).toEqual([existing]);
  });

  it('a failed trash does not clobber a DIFFERENT row written into the same cache entry while the trash call was in flight (id-scoped restore, not a whole-cache snapshot)', async () => {
    // Regression: an earlier version of useTrashLink snapshotted the WHOLE
    // matching `['links']` cache entry in `onMutate` (via `getQueriesData`)
    // and restored that whole snapshot verbatim in `onError` — which would
    // silently WIPE OUT any row written into the same cache entry after the
    // snapshot was taken but before the failed trash's rollback ran (e.g. a
    // concurrent tag mutation's invalidate-driven refetch landing on the same
    // link, or another capture). This test reproduces exactly that ordering:
    // seed 'target' alone, start trashing it (onMutate snapshots + removes
    // it), then — while the trash POST is still unresolved — write 'other'
    // into the SAME cache entry (standing in for a concurrent mutation's
    // write), then let the trash call fail. A whole-snapshot restore would
    // overwrite the cache back to "[target]" and silently drop 'other'; the
    // id-scoped restore re-inserts only 'target', leaving 'other' intact.
    const { queryClient, TrashWrapper } = makeWrapper();
    const existing: LinksResponse = { links: [makeLink({ id: 'target' })] };
    queryClient.setQueryData(queryKeys.links(), { pages: [existing], pageParams: [undefined] });

    let resolveTrash!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTrash = resolve;
        }),
    );

    const { result } = renderHook(() => useTrashLink('target'), { wrapper: TrashWrapper });

    act(() => {
      result.current.mutate();
    });

    // Wait for the optimistic removal to land (onMutate has run).
    await waitFor(() => {
      const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
      expect(cache?.pages[0]?.links).toHaveLength(0);
    });

    // A concurrent write lands in the SAME cache entry while trash is still in flight.
    act(() => {
      const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
      queryClient.setQueryData(queryKeys.links(), {
        ...cache,
        pages: [{ links: [makeLink({ id: 'other' })] }],
      });
    });

    resolveTrash(jsonResponse({ error: 'not_found', message: 'gone' }, 404));

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cache = queryClient.getQueryData<{ pages: LinksResponse[] }>(queryKeys.links());
    const ids = cache?.pages[0]?.links.map((l) => l.id).sort();
    expect(ids).toEqual(['other', 'target']);
  });

  it("invalidates links/counts/tags on settle (a link moving to trash drops the live count AND its tags' per-tag counts)", async () => {
    const { queryClient, TrashWrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ link: makeLink({ id: '1', tags: [] }) }, 200),
    );

    const { result } = renderHook(() => useTrashLink('1'), { wrapper: TrashWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
  });
});

describe('useAddTag / useRemoveTag', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('useAddTag POSTs { tag } to /api/links/:id/tags', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ link: makeLink({ id: '1', tags: ['mcp'] }) }, 200),
    );

    const { result } = renderHook(() => useAddTag('1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('mcp');
    });

    expect(fetch).toHaveBeenCalledWith('/api/links/1/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: 'mcp' }),
      credentials: 'include',
    });
  });

  it('useRemoveTag DELETEs /api/links/:id/tags/:tag (URL-encoded)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: makeLink({ id: '1' }) }, 200));

    const { result } = renderHook(() => useRemoveTag('1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('a tag');
    });

    expect(fetch).toHaveBeenCalledWith('/api/links/1/tags/a%20tag', {
      method: 'DELETE',
      credentials: 'include',
    });
  });

  it('useAddTag invalidates links/tags on settle, but NOT counts (tag membership changes, live/trash counts do not)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function TagsWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: makeLink({ id: '1' }) }, 200));

    const { result } = renderHook(() => useAddTag('1'), { wrapper: TagsWrapper });
    await act(async () => {
      await result.current.mutateAsync('mcp');
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
    expect(invalidatedKeys).not.toContainEqual(queryKeys.counts());
  });

  it('useRemoveTag invalidates links/tags on settle, but NOT counts (mirrors useAddTag)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function TagsWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: makeLink({ id: '1' }) }, 200));

    const { result } = renderHook(() => useRemoveTag('1'), { wrapper: TagsWrapper });
    await act(async () => {
      await result.current.mutateAsync('mcp');
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
    expect(invalidatedKeys).not.toContainEqual(queryKeys.counts());
  });
});

describe('useCreateTag', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs { name } to /api/tags and invalidates tags on settle', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function CreateTagWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ name: 'design' }, 201));

    const { result } = renderHook(() => useCreateTag(), { wrapper: CreateTagWrapper });

    await act(async () => {
      await result.current.mutateAsync('design');
    });

    expect(fetch).toHaveBeenCalledWith('/api/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'design' }),
      credentials: 'include',
    });
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
  });

  it('surfaces an error for a blank/invalid tag name', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'validation_error', message: 'Tag name must not be blank' }, 400),
    );

    const { result } = renderHook(() => useCreateTag(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('   ').catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useTrashList', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes from loading to success with the trash payload', async () => {
    const trash = { links: [makeTrashLink({ id: '1' })] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(trash));

    const { result } = renderHook(() => useTrashList(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(trash);
    expect(fetch).toHaveBeenCalledWith('/api/trash', { credentials: 'include' });
  });

  it('does NOT fetch when enabled: false (the command palette gates this to trash scope)', async () => {
    renderHook(() => useTrashList({ enabled: false }), { wrapper });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces an error state when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    const { result } = renderHook(() => useTrashList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRestoreLink', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function RestoreWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { queryClient, RestoreWrapper };
  }

  it('POSTs to /api/links/:id/restore', async () => {
    const { RestoreWrapper } = makeWrapper();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ outcome: 'restored', link: makeLink({ id: '1' }) }, 200),
    );

    const { result } = renderHook(() => useRestoreLink('1'), { wrapper: RestoreWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(fetch).toHaveBeenCalledWith('/api/links/1/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
  });

  it('optimistically removes the row from the trash cache before the server responds', async () => {
    const { queryClient, RestoreWrapper } = makeWrapper();
    const existing: TrashResponse = {
      links: [makeTrashLink({ id: 'target' }), makeTrashLink({ id: 'keep' })],
    };
    queryClient.setQueryData(queryKeys.trash(), existing);

    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useRestoreLink('target'), { wrapper: RestoreWrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      const cache = queryClient.getQueryData<TrashResponse>(queryKeys.trash());
      expect(cache?.links.map((l) => l.id)).toEqual(['keep']);
    });
  });

  it('re-inserts the row if the restore call fails', async () => {
    const { queryClient, RestoreWrapper } = makeWrapper();
    const existing: TrashResponse = { links: [makeTrashLink({ id: 'target' })] };
    queryClient.setQueryData(queryKeys.trash(), existing);

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'not_found', message: 'gone' }, 404),
    );

    const { result } = renderHook(() => useRestoreLink('target'), { wrapper: RestoreWrapper });

    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cache = queryClient.getQueryData<TrashResponse>(queryKeys.trash());
    expect(cache?.links.map((l) => l.id)).toEqual(['target']);
  });

  it('invalidates trash/links/counts/tags on settle (restoring un-trashes a link)', async () => {
    const { queryClient, RestoreWrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ outcome: 'restored', link: makeLink({ id: '1' }) }, 200),
    );

    const { result } = renderHook(() => useRestoreLink('1'), { wrapper: RestoreWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.trash());
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
  });
});

describe('useDeleteNow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function DeleteWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { queryClient, DeleteWrapper };
  }

  it('DELETEs /api/trash/:id', async () => {
    const { DeleteWrapper } = makeWrapper();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useDeleteNow('1'), { wrapper: DeleteWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(fetch).toHaveBeenCalledWith('/api/trash/1', {
      method: 'DELETE',
      credentials: 'include',
    });
  });

  it('optimistically removes the row from the trash cache before the server responds', async () => {
    const { queryClient, DeleteWrapper } = makeWrapper();
    const existing: TrashResponse = { links: [makeTrashLink({ id: 'target' })] };
    queryClient.setQueryData(queryKeys.trash(), existing);

    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useDeleteNow('target'), { wrapper: DeleteWrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      const cache = queryClient.getQueryData<TrashResponse>(queryKeys.trash());
      expect(cache?.links).toHaveLength(0);
    });
  });

  it('re-inserts the row if the delete call fails (the delete never actually happened)', async () => {
    const { queryClient, DeleteWrapper } = makeWrapper();
    const existing: TrashResponse = { links: [makeTrashLink({ id: 'target' })] };
    queryClient.setQueryData(queryKeys.trash(), existing);

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'not_found', message: 'gone' }, 404),
    );

    const { result } = renderHook(() => useDeleteNow('target'), { wrapper: DeleteWrapper });

    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cache = queryClient.getQueryData<TrashResponse>(queryKeys.trash());
    expect(cache?.links.map((l) => l.id)).toEqual(['target']);
  });

  it('invalidates trash/counts on settle', async () => {
    const { queryClient, DeleteWrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useDeleteNow('1'), { wrapper: DeleteWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.trash());
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
  });
});

describe('useEmptyTrash', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DELETEs /api/trash and invalidates trash/counts on settle', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function EmptyWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ deleted: 3 }, 200));

    const { result } = renderHook(() => useEmptyTrash(), { wrapper: EmptyWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(fetch).toHaveBeenCalledWith('/api/trash', { method: 'DELETE', credentials: 'include' });
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.trash());
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
  });

  it('surfaces an error if the request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    const { result } = renderHook(() => useEmptyTrash(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRetryCapture', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/links/:id/retry and invalidates links/link on settle, but NOT counts/tags (a retry only resets this link's own captureStatus)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function RetryWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ link: makeLink({ id: '1', captureStatus: 'enriching' }) }, 200),
    );

    const { result } = renderHook(() => useRetryCapture('1'), { wrapper: RetryWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(fetch).toHaveBeenCalledWith('/api/links/1/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(['link']);
    expect(invalidatedKeys).not.toContainEqual(queryKeys.counts());
    expect(invalidatedKeys).not.toContainEqual(queryKeys.tags());
  });
});

describe('runBulk', () => {
  it('fires every id concurrently and reports all as succeeded when every call resolves', async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    const result = await runBulk(['a', 'b', 'c'], mutationFn);

    expect(mutationFn).toHaveBeenCalledTimes(3);
    expect(result.succeeded.sort()).toEqual(['a', 'b', 'c']);
    expect(result.failed).toEqual([]);
  });

  it('tolerates a partial failure — one rejected id does not abort the others', async () => {
    const mutationFn = vi.fn().mockImplementation((id: string) => {
      if (id === 'bad') return Promise.reject(new Error('nope'));
      return Promise.resolve(undefined);
    });

    const result = await runBulk(['good1', 'bad', 'good2'], mutationFn);

    expect(result.succeeded.sort()).toEqual(['good1', 'good2']);
    expect(result.failed).toEqual(['bad']);
  });

  it('returns empty succeeded/failed for an empty id list (no-op)', async () => {
    const mutationFn = vi.fn();
    const result = await runBulk([], mutationFn);

    expect(mutationFn).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [] });
  });
});

describe('useBulkTrash', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loops POST /api/links/:id/trash for every selected id', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function BulkWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ link: makeLink({ tags: [] }) }, 200));

    const { result } = renderHook(() => useBulkTrash(), { wrapper: BulkWrapper });

    await act(async () => {
      await result.current.mutateAsync(['a', 'b']);
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/links/a/trash',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/links/b/trash',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it("invalidates links/trash/counts/tags once at the end, not once per id (each moved link drops its own tags' counts AND the live/trash tally)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function BulkWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ link: makeLink({ tags: [] }) }, 200));

    const { result } = renderHook(() => useBulkTrash(), { wrapper: BulkWrapper });

    await act(async () => {
      await result.current.mutateAsync(['a', 'b', 'c']);
    });

    const trashInvalidateCalls = invalidateSpy.mock.calls.filter(
      (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(queryKeys.trash()),
    );
    expect(trashInvalidateCalls).toHaveLength(1);

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(queryKeys.trash());
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
  });

  it('a partial failure still resolves — the mutation does not reject overall', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function BulkWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/links/bad/trash') {
        return Promise.resolve(jsonResponse({ error: 'not_found', message: 'gone' }, 404));
      }
      return Promise.resolve(jsonResponse({ link: makeLink({ tags: [] }) }, 200));
    });

    const { result } = renderHook(() => useBulkTrash(), { wrapper: BulkWrapper });

    let outcome: { succeeded: string[]; failed: string[] } | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync(['good', 'bad']);
    });

    expect(outcome?.succeeded).toEqual(['good']);
    expect(outcome?.failed).toEqual(['bad']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useBulkRestore / useBulkDeleteNow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('useBulkRestore loops POST /api/links/:id/restore and invalidates trash/links/counts/tags', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function RestoreBulkWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ outcome: 'restored', link: makeLink({ id: '1' }) }, 200),
    );

    const { result } = renderHook(() => useBulkRestore(), { wrapper: RestoreBulkWrapper });

    await act(async () => {
      await result.current.mutateAsync(['a', 'b']);
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/links/a/restore',
      expect.objectContaining({ method: 'POST' }),
    );
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.trash());
    expect(invalidatedKeys).toContainEqual(['links']);
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
    expect(invalidatedKeys).toContainEqual(queryKeys.tags());
  });

  it('useBulkDeleteNow loops DELETE /api/trash/:id and invalidates trash/counts', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function DeleteBulkWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const { result } = renderHook(() => useBulkDeleteNow(), { wrapper: DeleteBulkWrapper });

    await act(async () => {
      await result.current.mutateAsync(['a', 'b']);
    });

    expect(fetch).toHaveBeenCalledWith('/api/trash/a', {
      method: 'DELETE',
      credentials: 'include',
    });
    expect(fetch).toHaveBeenCalledWith('/api/trash/b', {
      method: 'DELETE',
      credentials: 'include',
    });
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.trash());
    expect(invalidatedKeys).toContainEqual(queryKeys.counts());
  });
});
