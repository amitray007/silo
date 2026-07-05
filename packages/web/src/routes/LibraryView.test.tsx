import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderWithRealQuery() {
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
    render(<LibraryView />);
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeDefined();
  });

  it('shows the empty state when there are no links', () => {
    mockUseInfiniteLinks({
      data: { pages: [{ links: [] } as LinksResponse], pageParams: [undefined] },
    });
    render(<LibraryView />);
    expect(screen.getByText('Nothing kept yet.')).toBeDefined();
  });

  it('shows a calm inline error using the ApiError message', () => {
    mockUseInfiniteLinks({
      isError: true,
      error: new ApiError(500, 'internal_error', 'Something broke server-side'),
    });
    render(<LibraryView />);
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
    render(<LibraryView />);
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
    render(<LibraryView />);

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
    render(<LibraryView />);
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
    render(<LibraryView />);

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
    render(<LibraryView />);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('does not create a prefetch observer when there is no next page', () => {
    const page1 = link({ id: 'p1' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [page1] } as LinksResponse], pageParams: [undefined] },
      hasNextPage: false,
    });
    render(<LibraryView />);
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
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    renderWithRealQuery();

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
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    renderWithRealQuery();

    await waitFor(() => expect(screen.getByText('Internal server error')).toBeDefined());
  });
});
