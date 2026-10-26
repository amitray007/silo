import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoverPreviewProvider } from '../components/HoverPreviewContext';
import { RowMenuProvider } from '../components/RowMenuContext';
import { makeTrashLink as trashLink } from '../test/fixtures';
import { TrashView } from './TrashView';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Trash uses the same menu, hover-preview, and query providers as Library. */
function renderTrashView(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <TrashView />
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('TrashView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the empty state when the trash is empty', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [] }));
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTrashView(fetchImpl);

    await waitFor(() => expect(screen.getByText('Trash is empty')).toBeDefined());
    expect(screen.queryByText('Select all')).toBeNull();
  });

  it('renders day-grouped trash rows with the purge countdown', async () => {
    // Trashed "just now" so this is deterministically in the "Today" bucket
    // regardless of wall-clock time-of-day, with a countdown of (close to)
    // the full 30-day window — asserted as a range rather than an exact
    // value, since a fraction of a day may already have elapsed depending on
    // when the test happens to run.
    const link = trashLink({
      id: '1',
      title: 'An old post',
      url: 'https://example.com/old',
      deletedAt: new Date().toISOString(),
    });
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [link] }));
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 1, purgeWindowDays: 30 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTrashView(fetchImpl);

    await waitFor(() => expect(screen.getByText('An old post')).toBeDefined());
    const heading = screen.getByRole('heading', { name: 'Trash' });
    expect(heading.textContent).toBe('Trash');
    expect(screen.getByText('Today')).toBeDefined();
    const countdown = screen.getByText(/^Purges in (29|30) days$/);
    expect(countdown).toBeDefined();
  });

  it.each(['inline', 'menu'])(
    'the %s restore action calls only its row endpoint',
    async (action) => {
      const link = trashLink({ id: '1', title: 'Restore me', url: 'https://example.com/r' });
      const fetchImpl = vi
        .fn()
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? 'GET';
          if (method === 'POST' && url === '/api/links/1/restore') {
            return Promise.resolve(jsonResponse({ outcome: 'restored', link }, 200));
          }
          if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [link] }));
          if (url === '/api/counts') {
            return Promise.resolve(jsonResponse({ live: 0, trash: 1, purgeWindowDays: 30 }));
          }
          throw new Error(`unexpected fetch: ${method} ${url}`);
        }) as unknown as typeof fetch;

      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('Restore me')).toBeDefined());
      if (action === 'menu') {
        fireEvent.click(screen.getByRole('button', { name: 'Options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
      } else {
        const row = screen.getByText('Restore me').closest('a') as HTMLElement;
        fireEvent.click(within(row).getByRole('button', { name: 'Restore' }));
      }

      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledWith(
          '/api/links/1/restore',
          expect.objectContaining({ method: 'POST' }),
        ),
      );
    },
  );

  it.each(['inline', 'menu'])(
    'the %s delete action confirms before deleting its row',
    async (action) => {
      const link = trashLink({ id: '1', title: 'Delete me', url: 'https://example.com/d' });
      const fetchImpl = vi
        .fn()
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? 'GET';
          if (method === 'DELETE' && url === '/api/trash/1') {
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [link] }));
          if (url === '/api/counts') {
            return Promise.resolve(jsonResponse({ live: 0, trash: 1, purgeWindowDays: 30 }));
          }
          throw new Error(`unexpected fetch: ${method} ${url}`);
        }) as unknown as typeof fetch;

      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('Delete me')).toBeDefined());
      if (action === 'menu') {
        fireEvent.click(screen.getByRole('button', { name: 'Options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete now' }));
      } else fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
      expect(fetchImpl).not.toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/trash\//),
        expect.objectContaining({ method: 'DELETE' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      if (action === 'menu') {
        fireEvent.click(screen.getByRole('button', { name: 'Options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete now' }));
      } else fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));

      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledWith('/api/trash/1', {
          method: 'DELETE',
          headers: { 'X-Silo-CSRF': '1' },
          credentials: 'include',
        }),
      );
    },
  );

  it('shows the purge hint without bulk controls', async () => {
    const link = trashLink({ id: '1', title: 'One', url: 'https://example.com/1' });
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [link] }));
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 1, purgeWindowDays: 30 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTrashView(fetchImpl);

    await waitFor(() => expect(screen.getByText('One')).toBeDefined());
    expect(screen.getByText(/auto-empties after 30 days/)).toBeDefined();
    expect(screen.queryByText('Select all')).toBeNull();
  });

  /**
   * The header's search input (`TrashSearchInput`, formerly the Trash search
   * slice) was REMOVED by a later user-feedback pass — trash search now
   * lives entirely in the command palette (⌘K / `/`), mirroring the tag
   * page's own search-box removal. This replaces the old "search (Trash
   * search slice)" suite that drove typing through that now-gone input.
   */
  it('renders no search input in the header — the command palette handles trash search now', async () => {
    const browseLink = trashLink({
      id: 'browse-only',
      title: 'Browse feed item',
      url: 'https://example.com/browse-only',
    });
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [browseLink] }));
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 1, purgeWindowDays: 30 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTrashView(fetchImpl);

    await waitFor(() => expect(screen.getByText('Browse feed item')).toBeDefined());
    expect(screen.queryByPlaceholderText('Search trash')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Never requests the search endpoint — nothing in this view can trigger it anymore.
    expect(
      vi
        .mocked(fetchImpl)
        .mock.calls.some(([input]) => String(input).startsWith('/api/trash/search')),
    ).toBe(false);
  });
  /** The header owns the two-click confirmation. */
  describe('header "Empty trash" button', () => {
    function oneLinkFetch() {
      const item = trashLink({ id: '1', title: 'One', url: 'https://example.com/1' });
      return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'DELETE' && url === '/api/trash') {
          return Promise.resolve(jsonResponse({ deleted: 1 }, 200));
        }
        if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [item] }));
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 1, purgeWindowDays: 30 }));
        }
        throw new Error(`unexpected fetch: ${method} ${url}`);
      }) as unknown as typeof fetch;
    }

    it('does not appear when the trash is empty', async () => {
      const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [] }));
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('Trash is empty')).toBeDefined());
      expect(screen.queryByRole('button', { name: 'Empty trash' })).toBeNull();
    });

    it('appears when the trash is non-empty', async () => {
      renderTrashView(oneLinkFetch());

      await waitFor(() => expect(screen.getByText('One')).toBeDefined());
      expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDefined();
    });

    it('the first click flips to "Confirm?" without calling useEmptyTrash', async () => {
      const fetchImpl = oneLinkFetch();
      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('One')).toBeDefined());
      const button = screen.getByRole('button', { name: 'Empty trash' });
      fireEvent.click(button);

      expect(
        await screen.findByRole('button', { name: 'Confirm emptying the trash' }),
      ).toBeDefined();
      expect(fetchImpl).not.toHaveBeenCalledWith(
        '/api/trash',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('the second click (on "Confirm?") calls useEmptyTrash', async () => {
      const fetchImpl = oneLinkFetch();
      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('One')).toBeDefined());
      fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));

      const confirmButton = await screen.findByRole('button', {
        name: 'Confirm emptying the trash',
      });
      fireEvent.click(confirmButton);

      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledWith('/api/trash', {
          method: 'DELETE',
          headers: { 'X-Silo-CSRF': '1' },
          credentials: 'include',
        }),
      );
    });
  });
});
