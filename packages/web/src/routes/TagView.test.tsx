import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverPreviewProvider } from '../components/HoverPreviewContext';
import { RowMenuProvider } from '../components/RowMenuContext';
import { SelectionProvider } from '../components/SelectionContext';
import { makeLink as link } from '../test/fixtures';
import { TagView } from './TagView';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A minimal `IntersectionObserver` stub — jsdom doesn't implement it (shared shape with `LibraryView.test.tsx`). */
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/**
 * Renders `TagView` at `/tags/:name` with a real router (so `useParams`
 * resolves) and a real `QueryClient` (only `fetch` mocked) — mirrors
 * `LibraryView.test.tsx`'s "drive the real hook" style rather than mocking
 * `useInfiniteLinks` by hand, since this view's whole point is the `tag`
 * param actually reaching the request URL.
 */
function renderTagView(tagName: string, fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <SelectionProvider>
          <HoverPreviewProvider>
            <MemoryRouter initialEntries={[`/tags/${tagName}`]}>
              <Routes>
                <Route path="/" element={<div>landed on library</div>} />
                <Route path="/tags/:name" element={<TagView />} />
              </Routes>
            </MemoryRouter>
          </HoverPreviewProvider>
        </SelectionProvider>
      </RowMenuProvider>
    </QueryClientProvider>,
  );
}

describe('TagView', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests the tag-scoped feed and renders its title (# tag, spaced) + count', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 40, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links?tag=mcp') {
        return Promise.resolve(
          jsonResponse({ links: [link({ id: '1', title: 'MCP post', tags: ['mcp'] })] }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTagView('mcp', fetchImpl);

    await waitFor(() => expect(screen.getByText('MCP post')).toBeDefined());
    // A space after the `#` (bugfix, user report) — `#mcp` (no space) must
    // NOT be present as the heading text.
    expect(screen.getByRole('heading', { name: '# mcp' })).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledWith('/api/links?tag=mcp', { credentials: 'include' });
  });

  it('shows the tag-specific empty state (spaced # tag) when the tag has no live links', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links?tag=empty-tag') {
        return Promise.resolve(jsonResponse({ links: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTagView('empty-tag', fetchImpl);

    await waitFor(() => expect(screen.getByText('No links tagged # empty-tag yet.')).toBeDefined());
  });

  it('renders no search/paste input in the tag page header (bugfix: redundant search box removed)', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 5, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links?tag=mcp') {
        return Promise.resolve(jsonResponse({ links: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTagView('mcp', fetchImpl);

    await waitFor(() => expect(screen.getByRole('heading', { name: '# mcp' })).toBeDefined());
    // No Omnibar (search-icon "Paste a link to keep" bar) and no `#tag ✕`
    // clear-filter pill anywhere in the header — the header renders
    // title+count only for TagView now (LibraryView/TrashView keep theirs).
    expect(screen.queryByPlaceholderText('Paste a link to keep')).toBeNull();
    expect(screen.queryByTitle('Clear filter')).toBeNull();
  });

  it('a failed fetch surfaces the calm error state', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      return Promise.resolve(
        jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
      );
    }) as unknown as typeof fetch;

    renderTagView('mcp', fetchImpl);

    await waitFor(() => expect(screen.getByText('Internal server error')).toBeDefined());
  });

  // The former "capturing from a tag view applies that tag to the capture
  // request" test drove capture through the tag page's own Omnibar input
  // (`getByPlaceholderText('Paste a link to keep')`) — that input no longer
  // renders on `TagView` (this file's "no search/paste input" test above
  // covers its removal). Capture-from-a-tag-page ALSO works via the
  // document-level paste-anywhere listener (`usePasteCapture`, mounted once
  // in `AppFrame` and covered by its own `usePasteCapture.test.tsx`).

  /**
   * The header's "Add" button (`PasteCaptureButton`, reused from
   * `LibraryView.tsx` via `headerSlot={<PasteCaptureButton tags={[tag]} />}`,
   * method file "tag-capture-empty-trash" decision 3) — clicking it on a tag
   * page must apply the CURRENT tag to the capture request, so the new link
   * lands directly in this tag's own feed.
   */
  it('the header Add button captures with the current tag applied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: () => Promise.resolve('https://example.com/tagged-capture') },
      configurable: true,
    });

    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links?tag=mcp') {
        return Promise.resolve(jsonResponse({ links: [] }));
      }
      if (method === 'POST' && url === '/api/links') {
        return Promise.resolve(jsonResponse({ link: {} }, 201));
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    renderTagView('mcp', fetchImpl);

    const button = await screen.findByRole('button', { name: 'Add a link from the clipboard' });
    fireEvent.click(button);

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/links',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            url: 'https://example.com/tagged-capture',
            tags: ['mcp'],
            source: 'web',
          }),
        }),
      ),
    );
  });

  /**
   * The header's "Delete" button (`DeleteTagButton`) — a two-step in-button
   * confirm mirroring `TrashView`'s `TrashEmptyNowButton` EXACTLY: first
   * click flips the label to "Confirm?"; the second click actually calls
   * `DELETE /api/tags/:name` and navigates to `/` on success. Also proves
   * both header buttons ("Delete" + "Add") render as siblings under
   * `ContentHeader`'s own `gap: 13` flex row (the fragment `headerSlot`
   * passes doesn't create a wrapping DOM node, so no extra gap wrapper is
   * needed here).
   */
  it('the header Delete button requires two clicks (confirm), then deletes the tag and navigates to /', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links?tag=mcp') {
        return Promise.resolve(jsonResponse({ links: [] }));
      }
      if (method === 'DELETE' && url === '/api/tags/mcp') {
        return Promise.resolve(jsonResponse({ deleted: true }));
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    renderTagView('mcp', fetchImpl);

    // Both header buttons render. Each `HeaderActionButton` wraps itself in
    // its own `position:relative` div (for its flash toast), so the two
    // buttons' own parents differ — but those two wrapper divs are
    // THEMSELVES siblings directly under `ContentHeader`'s flex row (no
    // extra gap-wrapper span in between), which is what actually produces
    // the visible gap between "Delete" and "Add" via the header's own
    // `gap: 13`.
    const deleteButton = await screen.findByRole('button', { name: 'Delete this tag' });
    const addButton = await screen.findByRole('button', { name: 'Add a link from the clipboard' });
    const deleteWrapper = deleteButton.parentElement;
    const addWrapper = addButton.parentElement;
    expect(deleteWrapper?.parentElement).toBe(addWrapper?.parentElement);
    expect(Array.from(deleteWrapper?.parentElement?.children ?? [])).toEqual(
      expect.arrayContaining([deleteWrapper, addWrapper]),
    );

    // First click arms the confirm state — no delete request fired yet.
    fireEvent.click(deleteButton);
    const confirmButton = await screen.findByRole('button', { name: 'Confirm deleting this tag' });
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/tags/mcp', expect.anything());

    // Second click actually deletes and navigates to '/'.
    fireEvent.click(confirmButton);
    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/tags/mcp',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() => expect(screen.getByText('landed on library')).toBeDefined());
  });
});
