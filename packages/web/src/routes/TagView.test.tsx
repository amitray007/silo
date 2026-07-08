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
 * resolves) plus a landing route at `/` (so the pill's `onClearTag`
 * navigation is observable) and a real `QueryClient` (only `fetch` mocked) —
 * mirrors `LibraryView.test.tsx`'s "drive the real hook" style rather than
 * mocking `useInfiniteLinks` by hand, since this view's whole point is the
 * `tag` param actually reaching the request URL.
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

  it('requests the tag-scoped feed and renders its title + count', async () => {
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
    expect(screen.getByText('#mcp')).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledWith('/api/links?tag=mcp');
  });

  it('shows the tag-specific empty state when the tag has no live links', async () => {
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

    await waitFor(() => expect(screen.getByText('No links tagged #empty-tag yet.')).toBeDefined());
  });

  it('renders the #tag ✕ pill in the omnibar, and clicking it navigates back to /', async () => {
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

    await waitFor(() => expect(screen.getByTitle('Clear filter')).toBeDefined());
    fireEvent.click(screen.getByTitle('Clear filter'));
    await waitFor(() => expect(screen.getByText('landed on library')).toBeDefined());
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

  it('capturing from a tag view applies that tag to the capture request (plan 011, V3-3)', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url === '/api/links') {
        return Promise.resolve(
          jsonResponse(
            {
              link: link({ id: 's1', url: 'https://new-example.com', tags: ['mcp'] }),
              deduped: false,
            },
            201,
          ),
        );
      }
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 5, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/links?tag=mcp') return Promise.resolve(jsonResponse({ links: [] }));
      if (url === '/api/tags') return Promise.resolve(jsonResponse({ tags: [] }));
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    renderTagView('mcp', fetchImpl);
    await waitFor(() => expect(screen.getByText('No links tagged #mcp yet.')).toBeDefined());

    const input = screen.getByPlaceholderText('Paste a link to keep');
    fireEvent.change(input, { target: { value: 'https://new-example.com' } });
    await waitFor(() => expect(screen.getByText('Keep')).toBeDefined());
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/links',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://new-example.com', tags: ['mcp'] }),
        }),
      ),
    );
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  });
});
