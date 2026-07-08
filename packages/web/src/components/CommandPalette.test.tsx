import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink, makeTrashLink } from '../test/fixtures';
import { CommandPalette } from './CommandPalette';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Routes fetch to a canned response by matching the request path prefix — the palette fires useTags/useSearchLinks/useLinksByTag/useInfiniteLinks (or their trash equivalents) concurrently, so a single mockResolvedValueOnce chain can't express "whichever fires first." A fresh Response is built per call (never a shared instance — Response bodies can only be consumed once). */
function mockFetchByPath(routes: Record<string, unknown>) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [path, body] of Object.entries(routes)) {
      if (url.startsWith(path)) return Promise.resolve(jsonResponse(body));
    }
    return Promise.resolve(
      jsonResponse({ error: 'not_found', message: `no mock for ${url}` }, 404),
    );
  });
}

/**
 * Renders `CommandPalette` behind a live `useCommandPalette()` instance so
 * the real debounce timer and parse-on-every-render behavior are exercised,
 * not a hand-built stand-in — the very fix under test (#3, raw-vs-debounced
 * parse divergence) only exists if the real hook's timing is in play.
 * Wrapped in a `MemoryRouter` (page-scoping, direct user decision post-cmdk-
 * rebuild: the palette reads its scope via `usePaletteScope`'s `useMatch`
 * calls, which throw outside a Router) — `route` sets the CURRENT path the
 * palette scopes off, defaulting to `/` (library scope, the pre-scoping
 * behavior every non-scoping test in this file still exercises). Exposes an
 * `openViaKeydown` helper so tests can drive ⌘K exactly like a real user.
 */
async function renderPalette(route = '/') {
  const { useCommandPalette } = await import('../lib/useCommandPalette');
  function Harness() {
    const palette = useCommandPalette();
    return <CommandPalette palette={palette} />;
  }
  return render(<Harness />, { wrapper: (props) => wrapper({ ...props, route }) });
}

function wrapper({ children, route = '/' }: { children: ReactNode; route?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function pressCmdK() {
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
}

/** cmdk assigns its own opaque `id`s to each `Command.Item`/`Command.Input` (a `useId()` value, not one containing the underlying link id/tag name) — result rows are found by their VISIBLE text instead of a `link:<id>` DOM id, mirroring how a real user (or a screen reader) would locate them. `closest('[role="option"]')` recovers the row element itself for `aria-selected`/click assertions. */
function optionRowFor(text: string): HTMLElement {
  const row = screen.getByText(text).closest('[role="option"]');
  if (!row) throw new Error(`no [role="option"] ancestor for text ${JSON.stringify(text)}`);
  return row as HTMLElement;
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing until opened', async () => {
    mockFetchByPath({ '/api/tags': { tags: [] } });
    const { container } = await renderPalette();
    expect(container.textContent).toBe('');
  });

  it('⌘K opens the dialog with the combobox focused', async () => {
    mockFetchByPath({ '/api/tags': { tags: [] }, '/api/links': { links: [] } });
    await renderPalette();
    pressCmdK();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox')));
  });

  it('plain text query fetches GET /api/links/search?q= and renders the result', async () => {
    mockFetchByPath({
      '/api/tags': { tags: [] },
      '/api/links/search': {
        results: [{ ...makeLink({ id: 'r1', title: 'React hooks guide' }), rank: 1 }],
      },
    });
    await renderPalette();
    pressCmdK();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'react' } });
    await waitFor(() => expect(screen.getByText('React hooks guide')).toBeDefined(), {
      timeout: 2000,
    });
  });

  it('Enter on a link result opens it in a new tab (http url) and closes the palette', async () => {
    mockFetchByPath({
      '/api/tags': { tags: [] },
      '/api/links/search': {
        results: [
          { ...makeLink({ id: 'r2', url: 'https://example.com/x', title: 'Open me' }), rank: 1 },
        ],
      },
    });
    await renderPalette();
    pressCmdK();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'x' } });
    await waitFor(() => expect(screen.getByText('Open me')).toBeDefined(), { timeout: 2000 });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a non-http(s) scheme is never passed to window.open (review fix #8: scheme guard)', async () => {
    mockFetchByPath({
      '/api/tags': { tags: [] },
      '/api/links/search': {
        results: [
          {
            ...makeLink({ id: 'r3', url: 'javascript:alert(1)', title: 'Malicious' }),
            rank: 1,
          },
        ],
      },
    });
    await renderPalette();
    pressCmdK();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'mal' } });
    await waitFor(() => expect(screen.getByText('Malicious')).toBeDefined(), { timeout: 2000 });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.open).not.toHaveBeenCalled();
    // Still closes (Enter "acted"), it just never navigated anywhere.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('#tag matching a known tag with no other text -> tag-list mode (GET /api/links?tag=)', async () => {
    mockFetchByPath({
      '/api/tags': { tags: [{ name: 'frontend', count: 1 }] },
      '/api/links?tag=frontend': { links: [makeLink({ id: 'l1', title: 'Tagged link' })] },
    });
    await renderPalette();
    pressCmdK();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: '#frontend ' } });
    await waitFor(() => expect(screen.getByText('Tagged link')).toBeDefined(), { timeout: 2000 });
  });

  it('a still-typing #partial tag (no trailing space) shows tag suggestions, not link results', async () => {
    mockFetchByPath({
      '/api/tags': { tags: [{ name: 'frontend', count: 3 }] },
    });
    await renderPalette();
    pressCmdK();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: '#front' } });
    await waitFor(() => expect(screen.getByText('frontend')).toBeDefined(), { timeout: 2000 });
    expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe('Matching tags');
  });

  it('clicking a tag suggestion applies it (completes to #name, does not open a page)', async () => {
    mockFetchByPath({
      '/api/tags': { tags: [{ name: 'frontend', count: 3 }] },
    });
    await renderPalette();
    pressCmdK();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: '#front' } });
    await waitFor(() => expect(screen.getByText('frontend')).toBeDefined(), { timeout: 2000 });
    fireEvent.click(screen.getByText('frontend'));
    expect(window.open).not.toHaveBeenCalled();
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('#frontend '));
  });

  it('Escape closes the palette', async () => {
    mockFetchByPath({ '/api/tags': { tags: [] }, '/api/links': { links: [] } });
    await renderPalette();
    pressCmdK();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ArrowDown/ArrowUp move the active option, wrapping at both ends (cmdk-driven keyboard nav)', async () => {
    mockFetchByPath({
      '/api/tags': { tags: [] },
      '/api/links/search': {
        results: [
          { ...makeLink({ id: 'a', title: 'Link A' }), rank: 1 },
          { ...makeLink({ id: 'b', title: 'Link B' }), rank: 1 },
        ],
      },
    });
    await renderPalette();
    pressCmdK();
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'x' } });
    await waitFor(() => expect(screen.getByText('Link A')).toBeDefined(), { timeout: 2000 });

    // cmdk defaults the first row active; assert via `aria-selected` on each
    // row (not `aria-activedescendant`'s VALUE, which is cmdk's own opaque
    // generated id, not the link id) — the input's `aria-activedescendant`
    // still tracks whichever row carries `aria-selected="true"`.
    expect(optionRowFor('Link A').getAttribute('aria-selected')).toBe('true');
    expect(optionRowFor('Link B').getAttribute('aria-selected')).toBe('false');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(optionRowFor('Link B').getAttribute('aria-selected')).toBe('true');
    expect(optionRowFor('Link A').getAttribute('aria-selected')).toBe('false');

    // loop={true} wraps past the last row back to the first.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(optionRowFor('Link A').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(optionRowFor('Link B').getAttribute('aria-selected')).toBe('true');
  });

  describe('activeIndex clamping on an async results shrink (review fix #2)', () => {
    it('Enter still acts on a valid row after the result list shrinks WITHOUT a keystroke', async () => {
      // Two results at first (the active row moved to the second), then the
      // SAME query re-resolves (e.g. TanStack's own refetch/settle) with
      // only ONE result — cmdk keeps its own active-item state in sync as
      // items unmount, so a real bug here would leave Enter targeting a row
      // that no longer exists and silently no-op.
      let resultCount = 2;
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/tags')) return Promise.resolve(jsonResponse({ tags: [] }));
        if (url.startsWith('/api/links/search')) {
          const all = [
            { ...makeLink({ id: 'a', url: 'https://example.com/a', title: 'Link A' }), rank: 1 },
            { ...makeLink({ id: 'b', url: 'https://example.com/b', title: 'Link B' }), rank: 1 },
          ];
          return Promise.resolve(jsonResponse({ results: all.slice(0, resultCount) }));
        }
        return Promise.resolve(jsonResponse({ error: 'not_found', message: url }, 404));
      });

      const { useCommandPalette } = await import('../lib/useCommandPalette');
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      function Harness() {
        const palette = useCommandPalette();
        return <CommandPalette palette={palette} />;
      }
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/']}>
            <Harness />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'x' } });
      await waitFor(() => expect(screen.getByText('Link B')).toBeDefined(), { timeout: 2000 });

      // Move active to the SECOND row.
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(optionRowFor('Link B').getAttribute('aria-selected')).toBe('true');

      // Now shrink the result set out from under the palette WITHOUT any
      // keystroke — invalidate + refetch, exactly like a live TanStack
      // refetch would.
      resultCount = 1;
      await act(async () => {
        await queryClient.invalidateQueries();
      });
      await waitFor(() => expect(screen.queryByText('Link B')).toBeNull(), { timeout: 2000 });

      // The remaining row is active — Enter opens IT, not a no-op.
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(window.open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener');
    });
  });

  it('an empty query shows only the 5 most recent links, not the full library (bugfix: default recent-5)', async () => {
    const sevenLinks = Array.from({ length: 7 }, (_, i) =>
      makeLink({ id: `l${i}`, title: `Link ${i}` }),
    );
    mockFetchByPath({
      '/api/tags': { tags: [] },
      '/api/links': { links: sevenLinks },
    });
    await renderPalette();
    pressCmdK();
    await screen.findByRole('combobox');

    // All 7 exist in the mocked API response, but the palette's empty-query
    // default must show only the first `RECENT_DEFAULT_COUNT` (5) of them.
    await waitFor(() => expect(screen.getByText('Link 0')).toBeDefined());
    expect(screen.getByText('Link 4')).toBeDefined();
    expect(screen.queryByText('Link 5')).toBeNull();
    expect(screen.queryByText('Link 6')).toBeNull();
  });

  describe('flicker fix: previous results stay visible while a debounced query resettles (bugfix)', () => {
    it('never renders the "No results" empty state between two queries that both have real results', async () => {
      // A deferred second response — the FIRST query ("re") resolves
      // immediately with one result; the SECOND query ("react"), fired after
      // the debounce settles on more typing, is held open deliberately so
      // the test can assert on what's on screen WHILE it's still in flight
      // (the exact window the flicker bug lived in: a naive implementation
      // would render the "No results" / blank empty-state here, since
      // `results` for the new query key has no data yet).
      let resolveSecond: ((value: Response) => void) | undefined;
      const secondPromise = new Promise<Response>((resolve) => {
        resolveSecond = resolve;
      });
      // Split out of the mockImplementation callback purely to keep that
      // callback's own cognitive complexity under the lint ceiling (same
      // pattern as `respondToSettlingUrl` below).
      function respondToRekeyingUrl(url: string): Promise<Response> {
        if (url.startsWith('/api/tags')) return Promise.resolve(jsonResponse({ tags: [] }));
        if (url.startsWith('/api/links/search?q=react')) return secondPromise;
        if (url.startsWith('/api/links/search')) {
          return Promise.resolve(
            jsonResponse({
              results: [{ ...makeLink({ id: 'stale', title: 'Stale but real' }), rank: 1 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ error: 'not_found', message: url }, 404));
      }
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        return respondToRekeyingUrl(url);
      });

      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');

      fireEvent.change(input, { target: { value: 're' } });
      await waitFor(() => expect(screen.getByText('Stale but real')).toBeDefined(), {
        timeout: 2000,
      });

      // Type further so the debounced query re-keys to a DIFFERENT,
      // not-yet-resolved query ("react") — the previous row must still be
      // showing right now, not a blank/"No results" flash.
      fireEvent.change(input, { target: { value: 'react' } });
      // Give the debounce timer + microtask queue room to actually re-key
      // the query without waiting for the (deliberately unresolved) fetch.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 250));
      });
      expect(screen.getByText('Stale but real')).toBeDefined();
      expect(screen.queryByText('No results')).toBeNull();

      // Resolve the second query — the stale row is replaced by the real one.
      resolveSecond?.(jsonResponse({ results: [] }));
      await waitFor(() => expect(screen.getByText('No results')).toBeDefined(), {
        timeout: 2000,
      });
      expect(screen.queryByText('Stale but real')).toBeNull();
    });
  });

  describe('raw-vs-debounced parse consistency (review fix #3)', () => {
    it('typing a trailing space that settles a #tag never fires an unscoped search in the settling window', async () => {
      // The regression: showTagSuggestions used to read the RAW (undebounced)
      // parse while the actual query args read the DEBOUNCED parse. Typing
      // "#frontend" then a trailing space settles the tag INSTANTLY in the
      // raw parse, but for up to the debounce window the debounced parse
      // could still lag — if the two disagree, the fired query is an
      // unscoped text search instead of the tag-scoped one. Asserts that
      // whenever the UI is showing something other than "tag suggestions",
      // the fetch it fires is never a bare, unscoped q= search sitting where
      // a tag-list fetch should be.
      const fetchedUrls: string[] = [];
      // Split out of the mockImplementation callback purely to keep that
      // callback's own cognitive complexity under the lint ceiling.
      function respondToSettlingUrl(url: string): Response {
        if (url.startsWith('/api/tags')) {
          return jsonResponse({ tags: [{ name: 'frontend', count: 1 }] });
        }
        if (url.startsWith('/api/links?tag=frontend')) {
          return jsonResponse({ links: [makeLink({ id: 'l1', title: 'Tagged' })] });
        }
        if (url.startsWith('/api/links/search')) {
          // An unscoped q-only search hitting here (no &tag=) while the tag
          // is meant to be settled would be exactly the bug this test
          // guards against.
          return jsonResponse({ results: [] });
        }
        return jsonResponse({ error: 'not_found', message: url }, 404);
      }
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        fetchedUrls.push(url);
        return Promise.resolve(respondToSettlingUrl(url));
      });

      const { useCommandPalette } = await import('../lib/useCommandPalette');
      function Harness() {
        const palette = useCommandPalette();
        return <CommandPalette palette={palette} />;
      }
      render(<Harness />, { wrapper });

      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: '#frontend ' } });

      await waitFor(() => expect(screen.getByText('Tagged')).toBeDefined(), { timeout: 2000 });

      // No unscoped /api/links/search?q= call for a bare "frontend" query
      // string ever fired once the tag settled — every search call (if any)
      // during this sequence must have carried the tag scope.
      const unscopedSearchCalls = fetchedUrls.filter(
        (u) => u.startsWith('/api/links/search') && !u.includes('tag=frontend'),
      );
      expect(unscopedSearchCalls).toEqual([]);
    });
  });

  /**
   * Page-scoping (direct user decision, post-cmdk-rebuild): the palette now
   * searches whatever surface it was opened from, per `usePaletteScope`.
   * These tests assert which HOOK/ENDPOINT fires for each page, not just
   * that SOME result renders — the whole point of scoping is that library
   * text search and trash text search hit different endpoints, and a tag
   * page's empty-query default is that TAG's recent links, not the whole
   * library's.
   */
  describe('page scoping (library vs trash vs tag)', () => {
    it('on the Library route (/), an empty query shows recent LIBRARY links via GET /api/links (unscoped)', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/links': { links: [makeLink({ id: 'lib1', title: 'Library recent' })] },
      });
      await renderPalette('/');
      pressCmdK();
      await waitFor(() => expect(screen.getByText('Library recent')).toBeDefined());
    });

    it('on the Library route, typed text hits GET /api/links/search?q= (never /api/trash/search)', async () => {
      const fetchedUrls: string[] = [];
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        fetchedUrls.push(url);
        if (url.startsWith('/api/tags')) return Promise.resolve(jsonResponse({ tags: [] }));
        if (url.startsWith('/api/links/search')) {
          return Promise.resolve(
            jsonResponse({
              results: [{ ...makeLink({ id: 'lib2', title: 'Library match' }), rank: 1 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ error: 'not_found', message: url }, 404));
      });
      await renderPalette('/');
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'match' } });
      await waitFor(() => expect(screen.getByText('Library match')).toBeDefined(), {
        timeout: 2000,
      });
      expect(fetchedUrls.some((u) => u.startsWith('/api/trash/search'))).toBe(false);
    });

    it('on the Trash route (/trash), an empty query shows recent TRASHED links via GET /api/trash (not /api/links)', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/trash': { links: [makeTrashLink({ id: 't1', title: 'Trashed recent' })] },
      });
      await renderPalette('/trash');
      pressCmdK();
      await waitFor(() => expect(screen.getByText('Trashed recent')).toBeDefined());
      expect(screen.getByRole('combobox').getAttribute('placeholder')).toBe('Search trash…');
    });

    it('on the Trash route, typed text hits GET /api/trash/search?q= (never /api/links/search)', async () => {
      const fetchedUrls: string[] = [];
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        fetchedUrls.push(url);
        if (url.startsWith('/api/tags')) return Promise.resolve(jsonResponse({ tags: [] }));
        if (url.startsWith('/api/trash/search')) {
          return Promise.resolve(
            jsonResponse({
              results: [{ ...makeTrashLink({ id: 't2', title: 'Trash match' }), rank: 1 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ error: 'not_found', message: url }, 404));
      });
      await renderPalette('/trash');
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'match' } });
      await waitFor(() => expect(screen.getByText('Trash match')).toBeDefined(), {
        timeout: 2000,
      });
      expect(fetchedUrls.some((u) => u.startsWith('/api/links/search'))).toBe(false);
    });

    it('Enter on a trash result still opens it in a new tab (the open/scheme-guard path is scope-agnostic)', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/trash': {
          links: [
            makeTrashLink({ id: 't3', url: 'https://example.com/trashed', title: 'Open trash' }),
          ],
        },
      });
      await renderPalette('/trash');
      pressCmdK();
      await waitFor(() => expect(screen.getByText('Open trash')).toBeDefined());
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(window.open).toHaveBeenCalledWith('https://example.com/trashed', '_blank', 'noopener');
    });

    it("on a Tag route (/tags/:name), an empty query shows that TAG's recent links via GET /api/links?tag=", async () => {
      mockFetchByPath({
        '/api/tags': { tags: [{ name: 'frontend', count: 1 }] },
        '/api/links?tag=frontend': {
          links: [makeLink({ id: 'tag1', title: 'Frontend recent' })],
        },
      });
      await renderPalette('/tags/frontend');
      pressCmdK();
      await waitFor(() => expect(screen.getByText('Frontend recent')).toBeDefined());
      expect(screen.getByRole('combobox').getAttribute('placeholder')).toBe('Search #frontend…');
    });

    it('on a Tag route, typed text is scoped to that tag via GET /api/links/search?q=&tag=<current>', async () => {
      const fetchedUrls: string[] = [];
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        fetchedUrls.push(url);
        if (url.startsWith('/api/tags')) {
          return Promise.resolve(jsonResponse({ tags: [{ name: 'frontend', count: 1 }] }));
        }
        if (url.startsWith('/api/links/search')) {
          return Promise.resolve(
            jsonResponse({
              results: [{ ...makeLink({ id: 'tag2', title: 'Scoped match' }), rank: 1 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ error: 'not_found', message: url }, 404));
      });
      await renderPalette('/tags/frontend');
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'match' } });
      await waitFor(() => expect(screen.getByText('Scoped match')).toBeDefined(), {
        timeout: 2000,
      });
      const searchCalls = fetchedUrls.filter((u) => u.startsWith('/api/links/search'));
      expect(searchCalls.length).toBeGreaterThan(0);
      expect(searchCalls.every((u) => u.includes('tag=frontend'))).toBe(true);
    });

    /** The per-URL routing table for the "explicit #tag overrides route scope" test below, split out purely to keep the `mockImplementation` callback's cognitive complexity under the lint ceiling (same pattern as `respondToSettlingUrl`/`respondToRekeyingUrl` above). */
    function respondToTagOverrideUrl(url: string): Response {
      if (url.startsWith('/api/tags')) {
        return jsonResponse({
          tags: [
            { name: 'frontend', count: 1 },
            { name: 'backend', count: 2 },
          ],
        });
      }
      // The route's own implicit scope ("frontend") legitimately fires once
      // on mount for the empty-query recent-list — that's expected, not the
      // bug under test. What matters is what's SHOWING once the user's
      // explicit #backend settles.
      if (url.startsWith('/api/links?tag=frontend')) {
        return jsonResponse({ links: [makeLink({ id: 'fe1', title: 'Frontend recent' })] });
      }
      if (url.startsWith('/api/links?tag=backend')) {
        return jsonResponse({ links: [makeLink({ id: 'be1', title: 'Backend link' })] });
      }
      return jsonResponse({ error: 'not_found', message: url }, 404);
    }

    it("on a Tag route, typing an EXPLICIT #othertag overrides the route's implicit tag scope", async () => {
      const fetchedUrls: string[] = [];
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        fetchedUrls.push(url);
        return Promise.resolve(respondToTagOverrideUrl(url));
      });
      // Route scope is "frontend" (/tags/frontend), but the user explicitly
      // types #backend — the explicit tag must win per usePaletteResults'
      // doc comment ("the user's own explicit #tag wins when present").
      await renderPalette('/tags/frontend');
      pressCmdK();
      await waitFor(() => expect(screen.getByText('Frontend recent')).toBeDefined());

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: '#backend ' } });
      await waitFor(() => expect(screen.getByText('Backend link')).toBeDefined(), {
        timeout: 2000,
      });
      // Once #backend has settled, the frontend-scoped row is gone — the
      // explicit tag fully replaced the route's implicit one, not merged
      // with or appended to it.
      expect(screen.queryByText('Frontend recent')).toBeNull();
    });
  });
});
