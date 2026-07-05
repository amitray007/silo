import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowMenuProvider } from '../components/RowMenuContext';
import { SelectionProvider } from '../components/SelectionContext';
import { makeTrashLink as trashLink } from '../test/fixtures';
import { TrashView } from './TrashView';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `TrashView`'s rows read `useTrashSelection()` for their checkbox — every render still needs `RowMenuProvider`/`SelectionProvider` ancestors, same shape as every other routed view's test harness. */
function renderTrashView(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <SelectionProvider>
          <TrashView />
        </SelectionProvider>
      </RowMenuProvider>
    </QueryClientProvider>,
  );
}

describe('TrashView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the empty state and no dock when the trash is empty', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [] }));
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderTrashView(fetchImpl);

    await waitFor(() => expect(screen.getByText('Trash is empty.')).toBeDefined());
    expect(screen.queryByText('select all')).toBeNull();
    expect(screen.queryByText('empty all')).toBeNull();
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
    expect(screen.getByText('Today')).toBeDefined();
    const countdown = screen.getByText(/^(29|30)d$/);
    expect(countdown).toBeDefined();
  });

  it('the restore icon button calls the restore endpoint', async () => {
    const link = trashLink({ id: '1', title: 'Restore me', url: 'https://example.com/r' });
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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
    fireEvent.click(screen.getByTitle('restore'));

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/links/1/restore',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('the delete-now icon button calls the hard-delete endpoint', async () => {
    const link = trashLink({ id: '1', title: 'Delete me', url: 'https://example.com/d' });
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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
    fireEvent.click(screen.getByTitle('delete now'));

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith('/api/trash/1', { method: 'DELETE' }),
    );
  });

  it('the idle trash dock ("select all · empty all") shows when the trash is non-empty and nothing is selected', async () => {
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
    expect(screen.getByText('select all')).toBeDefined();
    expect(screen.getByText('empty all')).toBeDefined();
  });

  it('"empty all" calls the empty-trash endpoint', async () => {
    const link = trashLink({ id: '1', title: 'One', url: 'https://example.com/1' });
    const fetchImpl = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && url === '/api/trash') {
        return Promise.resolve(jsonResponse({ deleted: 1 }, 200));
      }
      if (url === '/api/trash') return Promise.resolve(jsonResponse({ links: [link] }));
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 1, purgeWindowDays: 30 }));
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }) as unknown as typeof fetch;

    renderTrashView(fetchImpl);

    await waitFor(() => expect(screen.getByText('One')).toBeDefined());
    fireEvent.click(screen.getByText('empty all'));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/trash', { method: 'DELETE' }));
  });

  describe('multi-select', () => {
    /**
     * A route table keyed by `"{method} {url}"` rather than an if/else chain —
     * keeps this fixture's cognitive complexity low (biome's gate) while
     * covering the full two-row restore/delete-now matrix each multi-select
     * test below needs.
     */
    function twoLinkFetch() {
      const linkA = trashLink({ id: 'a', title: 'Row A', url: 'https://example.com/a' });
      const linkB = trashLink({ id: 'b', title: 'Row B', url: 'https://example.com/b' });
      const noContent = () => Promise.resolve(new Response(null, { status: 204 }));
      const routes: Record<string, () => Promise<Response>> = {
        'GET /api/trash': () => Promise.resolve(jsonResponse({ links: [linkA, linkB] })),
        'GET /api/counts': () =>
          Promise.resolve(jsonResponse({ live: 0, trash: 2, purgeWindowDays: 30 })),
        'POST /api/links/a/restore': () =>
          Promise.resolve(jsonResponse({ outcome: 'restored', link: linkA }, 200)),
        'POST /api/links/b/restore': () =>
          Promise.resolve(jsonResponse({ outcome: 'restored', link: linkB }, 200)),
        'DELETE /api/trash/a': noContent,
        'DELETE /api/trash/b': noContent,
      };

      return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const route = routes[`${method} ${url}`];
        if (!route) throw new Error(`unexpected fetch: ${method} ${url}`);
        return route();
      }) as unknown as typeof fetch;
    }

    it('"select all" selects every row and shows the trash selection dock', async () => {
      renderTrashView(twoLinkFetch());

      await waitFor(() => expect(screen.getByText('Row A')).toBeDefined());
      fireEvent.click(screen.getByText('select all'));

      expect(screen.getByText('2 selected')).toBeDefined();
      expect(screen.getByText('restore')).toBeDefined();
      expect(screen.getByText('delete now')).toBeDefined();
      expect(screen.getByText('clear')).toBeDefined();
    });

    it('the selection dock\'s "restore" bulk-restores every selected row', async () => {
      const fetchImpl = twoLinkFetch();
      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('Row A')).toBeDefined());
      fireEvent.click(screen.getByText('select all'));
      fireEvent.click(screen.getByText('restore'));

      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledWith(
          '/api/links/a/restore',
          expect.objectContaining({ method: 'POST' }),
        ),
      );
      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledWith(
          '/api/links/b/restore',
          expect.objectContaining({ method: 'POST' }),
        ),
      );
    });

    it('the selection dock\'s "delete now" bulk-deletes every selected row', async () => {
      const fetchImpl = twoLinkFetch();
      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('Row A')).toBeDefined());
      fireEvent.click(screen.getByText('select all'));
      fireEvent.click(screen.getByText('delete now'));

      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledWith('/api/trash/a', { method: 'DELETE' }),
      );
      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledWith('/api/trash/b', { method: 'DELETE' }),
      );
    });

    it('"clear" empties the selection and brings back the idle dock', async () => {
      renderTrashView(twoLinkFetch());

      await waitFor(() => expect(screen.getByText('Row A')).toBeDefined());
      fireEvent.click(screen.getByText('select all'));
      expect(screen.getByText('2 selected')).toBeDefined();

      fireEvent.click(screen.getByText('clear'));

      expect(screen.queryByText('2 selected')).toBeNull();
      expect(screen.getByText('select all')).toBeDefined();
    });

    it("acting on a row's own restore button drops it from the selection (no stale count)", async () => {
      // Review fix: select both rows, then click Row A's OWN restore icon
      // (not the dock's bulk restore) — Row A should leave the selection, so
      // the dock reads "1 selected", not a stale "2 selected" that includes a
      // now-restored id.
      renderTrashView(twoLinkFetch());

      await waitFor(() => expect(screen.getByText('Row A')).toBeDefined());
      fireEvent.click(screen.getByText('select all'));
      expect(screen.getByText('2 selected')).toBeDefined();

      // Row A's per-row restore button — `getAllByTitle('restore')` returns the
      // two rows' buttons plus, once a selection is active, the dock's own
      // "restore" is a text action (not title="restore"), so the two here are
      // the per-row ones in DOM order (A then B).
      const rowRestoreButtons = screen.getAllByTitle('restore');
      fireEvent.click(rowRestoreButtons[0] as HTMLElement);

      await waitFor(() => expect(screen.getByText('1 selected')).toBeDefined());
    });

    it('the bulk dock action is disabled while its batch is pending (no double-fire)', async () => {
      // Review fix: hold the restore requests open so the batch stays pending,
      // then assert the dock's restore/delete-now buttons are disabled.
      let releaseA!: (v: Response) => void;
      const routes: Record<string, () => Promise<Response>> = {
        'GET /api/trash': () =>
          Promise.resolve(
            jsonResponse({
              links: [
                trashLink({ id: 'a', title: 'Row A', url: 'https://example.com/a' }),
                trashLink({ id: 'b', title: 'Row B', url: 'https://example.com/b' }),
              ],
            }),
          ),
        'GET /api/counts': () =>
          Promise.resolve(jsonResponse({ live: 0, trash: 2, purgeWindowDays: 30 })),
        'POST /api/links/a/restore': () => new Promise<Response>((r) => (releaseA = r)),
        'POST /api/links/b/restore': () => Promise.resolve(new Response(null, { status: 204 })),
      };
      const fetchImpl = vi
        .fn()
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const route = routes[`${init?.method ?? 'GET'} ${String(input)}`];
          if (!route)
            throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${String(input)}`);
          return route();
        }) as unknown as typeof fetch;

      renderTrashView(fetchImpl);

      await waitFor(() => expect(screen.getByText('Row A')).toBeDefined());
      fireEvent.click(screen.getByText('select all'));

      const dockRestore = screen.getByText('restore').closest('button') as HTMLButtonElement;
      fireEvent.click(dockRestore);

      // While the batch is in flight, the dock's restore/delete-now are disabled.
      await waitFor(() => expect(dockRestore.disabled).toBe(true));
      const dockDelete = screen.getByText('delete now').closest('button') as HTMLButtonElement;
      expect(dockDelete.disabled).toBe(true);

      releaseA(new Response(null, { status: 204 }));
    });

    // Escape-clears-selection is covered end-to-end in `AppFrame.test.tsx`
    // (`RowMenuLayer` owns the single document-level Escape listener that
    // arbitrates between the row menu and both selection scopes — see that
    // component's doc comment) — `TrashView` rendered in isolation here has
    // no such listener mounted, so it isn't the right place to assert Escape
    // behavior.
  });
});
