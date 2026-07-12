import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import * as hooks from '../api/hooks';
import type { LinksResponse } from '../api/types';
import { HoverPreviewProvider } from '../components/HoverPreviewContext';
import { RowMenuProvider } from '../components/RowMenuContext';
import { SelectionProvider } from '../components/SelectionContext';
import { bucketByDay } from '../lib/buckets';
import { makeLink as link } from '../test/fixtures';
import { LibraryView } from './LibraryView';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `LibraryView` renders through TanStack Query hooks, so each test provides a
 * `QueryClientProvider` even when `useInfiniteLinks` is mocked directly. */
function renderLibraryView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <SelectionProvider>
          <HoverPreviewProvider>
            <LibraryView />
          </HoverPreviewProvider>
        </SelectionProvider>
      </RowMenuProvider>
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
    // Older links now group by calendar MONTH (feedback #14) — "Last month"
    // or a "{Month} {Year}" label — rather than a single "Earlier" bucket.
    // Derive the expected month label from bucketByDay so the test is
    // date-robust (a fixed offset would land in a different month over time).
    const now = new Date();
    const oldDate = new Date(now.getFullYear(), now.getMonth() - 2, 15); // ~2 months back
    const today = link({ id: 'today', title: 'Today link', createdAt: now.toISOString() });
    const old = link({ id: 'old', title: 'Old link', createdAt: oldDate.toISOString() });
    const groups = bucketByDay([today, old], now);
    const oldGroupLabel = groups.find((g) => g.items.some((l) => l.id === 'old'))?.label;

    mockUseInfiniteLinks({
      data: { pages: [{ links: [today, old] } as LinksResponse], pageParams: [undefined] },
    });
    renderLibraryView();
    expect(screen.getByText('Today')).toBeDefined();
    expect(screen.getByText('Today link')).toBeDefined();
    expect(screen.getByText('Old link')).toBeDefined();
    // The old link sits under its month group, not "Today".
    expect(oldGroupLabel).toBeDefined();
    expect(oldGroupLabel).not.toBe('Today');
    expect(screen.getByText(oldGroupLabel as string)).toBeDefined();
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
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/links') return Promise.resolve(jsonResponse(page1));
      if (url === '/api/links?cursor=c1') return Promise.resolve(jsonResponse(page2));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderLibraryView();

    await waitFor(() => expect(screen.getByText('Page one')).toBeDefined());
    expect(fetch).toHaveBeenCalledWith('/api/links', { credentials: 'include' });
    // hasNextPage is true (page1.nextCursor set): the real guard enables the observer.
    expect(FakeIntersectionObserver.instances).toHaveLength(1);

    const button = screen.getByRole('button', { name: 'Load more' });
    button.click();

    await waitFor(() => expect(screen.getByText('Page two')).toBeDefined());
    expect(fetch).toHaveBeenCalledWith('/api/links?cursor=c1', { credentials: 'include' });
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
 * Header box (later user-feedback pass): the omnibar is now a static,
 * non-interactive hint box — no input, no Enter-to-keep, no click-to-search.
 * The former "Capture (plan 011, V3-3)" suite that drove Enter-to-keep
 * through this box's `<input>` no longer applies (there is no input left to
 * drive); paste-to-capture (document-level) is covered end to end by
 * `usePasteCapture.test.tsx`, which is unaffected by this component-scoped
 * header change. The header's OWN paste-capture button (mobile/desktop tap
 * affordance, `PasteCaptureButton` in `LibraryView.tsx`) is covered by
 * `LibraryView.pasteButton.test.tsx`.
 */
describe('LibraryView header (no paste box)', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders no "Paste a link" hint box or input in the header (removed to match shiori)', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links') return Promise.resolve(jsonResponse({ links: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderLibraryView();
    await waitFor(() => expect(screen.getByText('Nothing kept yet.')).toBeDefined());

    // The header box is gone entirely — no hint text, no input. The ONLY
    // header button now is the paste-capture affordance (added below the
    // omnibar's removal) — assert there's exactly one, and it's that one.
    expect(screen.queryByText('Paste a link to keep')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a link from the clipboard' })).toBeDefined();

    // The title still renders (header didn't lose its heading).
    expect(screen.getByRole('heading', { name: 'Library' })).toBeDefined();
  });
});

/**
 * Multi-select (plan 011, V3-5): the row hover checkbox and the Library
 * selection dock ("N selected · move to trash · clear · esc"). Uses the same
 * `mockUseInfiniteLinks` bypass as the suite above for the feed itself, with
 * `fetch` mocked only for what multi-select actually calls: `useCounts`
 * (the header) and the bulk-trash POST loop.
 */
describe('LibraryView multi-select (plan 011, V3-5)', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 2, trash: 0, purgeWindowDays: 30 }));
        }
        if (url.startsWith('/api/links/') && url.endsWith('/trash')) {
          return Promise.resolve(jsonResponse({ link: link({ tags: [] }) }, 200));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hovering a row reveals its checkbox; clicking it selects the row and shows the selection dock', () => {
    const rowA = link({ id: 'a', title: 'Row A' });
    const rowB = link({ id: 'b', title: 'Row B' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [rowA, rowB] } as LinksResponse], pageParams: [undefined] },
    });
    renderLibraryView();

    const rowAAnchor = screen.getByText('Row A').closest('a') as HTMLElement;
    expect(screen.queryByTitle('Select')).toBeNull();

    fireEvent.mouseEnter(rowAAnchor);
    const checkbox = screen.getByTitle('Select');
    fireEvent.click(checkbox);

    expect(screen.getByText('1 selected')).toBeDefined();
    expect(screen.getByText('Move to trash')).toBeDefined();
  });

  it('once any row is selected, every row shows its checkbox (not just the hovered one)', () => {
    const rowA = link({ id: 'a', title: 'Row A' });
    const rowB = link({ id: 'b', title: 'Row B' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [rowA, rowB] } as LinksResponse], pageParams: [undefined] },
    });
    renderLibraryView();

    fireEvent.mouseEnter(screen.getByText('Row A').closest('a') as HTMLElement);
    fireEvent.click(screen.getByTitle('Select'));

    // Both rows' checkboxes are now present, even though only Row A is hovered.
    expect(screen.getAllByTitle('Select')).toHaveLength(2);
  });

  it('"move to trash" bulk-trashes every selected row and clears the selection', async () => {
    const rowA = link({ id: 'a', title: 'Row A' });
    const rowB = link({ id: 'b', title: 'Row B' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [rowA, rowB] } as LinksResponse], pageParams: [undefined] },
    });
    renderLibraryView();

    fireEvent.mouseEnter(screen.getByText('Row A').closest('a') as HTMLElement);
    fireEvent.click(screen.getByTitle('Select'));
    fireEvent.mouseEnter(screen.getByText('Row B').closest('a') as HTMLElement);
    fireEvent.click(screen.getAllByTitle('Select')[1] as HTMLElement);
    expect(screen.getByText('2 selected')).toBeDefined();

    fireEvent.click(screen.getByText('Move to trash'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/a/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/b/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull());
  });

  it('"clear" empties the selection without calling any mutation', () => {
    const rowA = link({ id: 'a', title: 'Row A' });
    mockUseInfiniteLinks({
      data: { pages: [{ links: [rowA] } as LinksResponse], pageParams: [undefined] },
    });
    renderLibraryView();

    fireEvent.mouseEnter(screen.getByText('Row A').closest('a') as HTMLElement);
    fireEvent.click(screen.getByTitle('Select'));
    expect(screen.getByText('1 selected')).toBeDefined();

    fireEvent.click(screen.getByText('Clear'));

    expect(screen.queryByText('1 selected')).toBeNull();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/trash'), expect.anything());
  });
});
