import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import * as hooks from '../api/hooks';
import type { LinksResponse } from '../api/types';
import { makeLink as link } from '../test/fixtures';
import { LibraryView } from './LibraryView';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `LibraryView` now also renders the v3 header bar via `useCounts()` (a real
 * `useQuery`) — every render needs a `QueryClientProvider` ancestor, even the
 * tests below that mock `useInfiniteLinks` directly via `vi.spyOn` and don't
 * care about the header's count. `useCounts` itself hits the mocked global
 * `fetch`; those tests don't assert on the header, so its (unmocked-URL)
 * response settling asynchronously after the assertions run is harmless.
 */
function renderLibraryView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LibraryView />
    </QueryClientProvider>,
  );
}

/** A minimal `IntersectionObserver` stub — jsdom doesn't implement it. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

type MockInfiniteLinksResult = Partial<ReturnType<typeof hooks.useInfiniteLinks>>;

function mockUseInfiniteLinks(overrides: MockInfiniteLinksResult) {
  vi.spyOn(hooks, 'useInfiniteLinks').mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  } as ReturnType<typeof hooks.useInfiniteLinks>);
}

describe('LibraryView', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the calm loading state on first page load', () => {
    mockUseInfiniteLinks({ isLoading: true });
    renderLibraryView();
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeDefined();
  });

  it('shows the empty state when there are no links', () => {
    mockUseInfiniteLinks({
      data: { pages: [{ links: [] } as LinksResponse], pageParams: [undefined] },
    });
    renderLibraryView();
    expect(screen.getByText('Nothing kept yet.')).toBeDefined();
  });

  it('shows a calm inline error using the ApiError message', () => {
    mockUseInfiniteLinks({
      isError: true,
      error: new ApiError(500, 'internal_error', 'Something broke server-side'),
    });
    renderLibraryView();
    expect(screen.getByText('Something broke server-side')).toBeDefined();
  });

  it('groups rows under the correct day labels', () => {
    const today = link({ id: 'today', title: 'Today link', createdAt: new Date().toISOString() });
    const old = link({
      id: 'old',
      title: 'Old link',
      createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [today, old] } as LinksResponse], pageParams: [undefined] },
    });
    renderLibraryView();
    expect(screen.getByText('Today')).toBeDefined();
    expect(screen.getByText('Earlier')).toBeDefined();
    expect(screen.getByText('Today link')).toBeDefined();
    expect(screen.getByText('Old link')).toBeDefined();
  });

  it('the load-more button calls fetchNextPage and page 2 appends once data updates', () => {
    const fetchNextPage = vi.fn();
    const page1 = link({ id: 'p1', title: 'Page one' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [page1] } as LinksResponse], pageParams: [undefined] },
      hasNextPage: true,
      fetchNextPage,
    });
    renderLibraryView();

    const button = screen.getByRole('button', { name: 'Load more' });
    button.click();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('appends page 2 rows once the mocked hook reflects two pages', () => {
    const page1 = link({ id: 'p1', title: 'Page one' });
    const page2 = link({ id: 'p2', title: 'Page two' });
    mockUseInfiniteLinks({
      data: {
        pages: [{ links: [page1] } as LinksResponse, { links: [page2] } as LinksResponse],
        pageParams: [undefined, 'cursor-1'],
      },
      hasNextPage: false,
    });
    renderLibraryView();
    expect(screen.getByText('Page one')).toBeDefined();
    expect(screen.getByText('Page two')).toBeDefined();
  });

  it('the sentinel intersecting triggers fetchNextPage exactly once when eligible', () => {
    const fetchNextPage = vi.fn();
    const page1 = link({ id: 'p1' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [page1] } as LinksResponse], pageParams: [undefined] },
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    });
    renderLibraryView();

    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    FakeIntersectionObserver.instances[0]?.fire(true);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('does not create a prefetch observer while already fetching the next page', () => {
    const page1 = link({ id: 'p1' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [page1] } as LinksResponse], pageParams: [undefined] },
      hasNextPage: true,
      isFetchingNextPage: true,
    });
    renderLibraryView();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('does not create a prefetch observer when there is no next page', () => {
    const page1 = link({ id: 'p1' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [page1] } as LinksResponse], pageParams: [undefined] },
      hasNextPage: false,
    });
    renderLibraryView();
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
});

/**
 * End-to-end pagination: drives the REAL `useInfiniteLinks` hook (a real
 * `QueryClient`, only `fetch` mocked) rather than a hand-authored mock of the
 * hook's return shape — so a bug in how `LibraryView` derives its guard from
 * TanStack Query's actual state machine (not just from a mock built to match
 * the expected shape) would be caught here.
 */
describe('LibraryView (real useInfiniteLinks, mocked fetch only)', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the first page, then the load-more button drives a real second fetch and disables the prefetch guard once exhausted', async () => {
    const page1: LinksResponse = {
      links: [link({ id: 'p1', title: 'Page one' })],
      nextCursor: 'c1',
    };
    const page2: LinksResponse = { links: [link({ id: 'p2', title: 'Page two' })] };
    // `LibraryView` also fires `useCounts()` for the header's count (v3) —
    // route the mock by URL rather than by call order, since both requests
    // are in flight together.
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 1, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links') return Promise.resolve(jsonResponse(page1));
      if (url === '/api/links?cursor=c1') return Promise.resolve(jsonResponse(page2));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderLibraryView();

    await waitFor(() => expect(screen.getByText('Page one')).toBeDefined());
    expect(fetch).toHaveBeenCalledWith('/api/links');
    // hasNextPage is true (page1.nextCursor set): the real guard enables the observer.
    expect(FakeIntersectionObserver.instances).toHaveLength(1);

    const button = screen.getByRole('button', { name: 'Load more' });
    button.click();

    await waitFor(() => expect(screen.getByText('Page two')).toBeDefined());
    expect(fetch).toHaveBeenCalledWith('/api/links?cursor=c1');
    // page2 has no nextCursor: hasNextPage flips false, the button disappears,
    // and the (re-created) observer for the exhausted state never fires again.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  });

  it('renders a calm inline error using the real ApiError surfaced by a failed fetch', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      return Promise.resolve(
        jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
      );
    });

    renderLibraryView();

    await waitFor(() => expect(screen.getByText('Internal server error')).toBeDefined());
  });
});

/**
 * Capture (plan 011, V3-3): Enter on a URL-looking omnibar query calls
 * `POST /api/links` and clears the bar, with the new row appearing instantly
 * (the optimistic insert) ahead of any server response — and the `◌ N
 * capturing` header indicator reflecting the resulting `enriching` row.
 * Drives the real `useListView`/`useCaptureLink`/`Omnibar` stack end to end
 * (only `fetch` is mocked), matching the "real hook" style above.
 */
describe('LibraryView capture (plan 011, V3-3)', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Enter on a URL query POSTs to /api/links, clears the bar, and shows the row + enriching indicator instantly', async () => {
    let resolveCapture!: (value: Response) => void;
    const capturePromise = new Promise<Response>((resolve) => {
      resolveCapture = resolve;
    });

    // Route by method (not just URL) since the capture POST and the feed's
    // GET both target `/api/links` — the never-resolving capture promise
    // must not block the feed's own GET/refetches.
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url === '/api/links') return capturePromise;
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links') return Promise.resolve(jsonResponse({ links: [] }));
      if (url === '/api/tags') return Promise.resolve(jsonResponse({ tags: [] }));
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    renderLibraryView();
    await waitFor(() => expect(screen.getByText('Nothing kept yet.')).toBeDefined());

    const input = screen.getByPlaceholderText(/paste a link to keep/i);
    fireEvent.change(input, { target: { value: 'https://new-example.com' } });
    await waitFor(() => expect(screen.getByText('keep')).toBeDefined());

    fireEvent.keyDown(input, { key: 'Enter' });

    // Cleared instantly, independent of the (still in-flight) server response.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    // The optimistic row renders before the server has responded (title + domain both read "new-example.com").
    await waitFor(() => expect(screen.getAllByText('new-example.com').length).toBeGreaterThan(0));
    // The header's enriching indicator reflects the optimistic `enriching` row.
    expect(screen.getByText('1 capturing')).toBeDefined();

    resolveCapture(
      jsonResponse(
        { link: link({ id: 'server-1', url: 'https://new-example.com' }), deduped: false },
        201,
      ),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/counts'));
  });

  it('Enter on non-URL search text does not capture (no POST fired)', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links') return Promise.resolve(jsonResponse({ links: [] }));
      if (url.startsWith('/api/links/search')) {
        return Promise.resolve(jsonResponse({ results: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderLibraryView();
    await waitFor(() => expect(screen.getByText('Nothing kept yet.')).toBeDefined());

    const input = screen.getByPlaceholderText(/paste a link to keep/i);
    fireEvent.change(input, { target: { value: 'react hooks' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The bar is untouched (no clear) and no POST was ever issued.
    expect((input as HTMLInputElement).value).toBe('react hooks');
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('a failed capture surfaces a calm error in the header (capture failure is never silent)', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url === '/api/links') {
        return Promise.resolve(
          jsonResponse({ error: 'invalid_url', message: 'Not a valid http(s) URL' }, 400),
        );
      }
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links') return Promise.resolve(jsonResponse({ links: [] }));
      if (url === '/api/tags') return Promise.resolve(jsonResponse({ tags: [] }));
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    renderLibraryView();
    await waitFor(() => expect(screen.getByText('Nothing kept yet.')).toBeDefined());

    const input = screen.getByPlaceholderText(/paste a link to keep/i);
    fireEvent.change(input, { target: { value: 'https://bad-example.com' } });
    await waitFor(() => expect(screen.getByText('keep')).toBeDefined());
    fireEvent.keyDown(input, { key: 'Enter' });

    // The bar clears optimistically, but the failure is surfaced, not silent.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Not a valid http(s) URL'),
    );
    // The rolled-back optimistic row is gone — no lingering "enriching" ghost.
    expect(screen.queryByText('bad-example.com')).toBeNull();
  });
});
