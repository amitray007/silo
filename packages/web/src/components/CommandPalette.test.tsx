import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsMap } from '../api/types';
import {
  githubSourceData,
  hackerNewsSourceData,
  makeLink,
  makeTrashLink,
  twitterSourceData,
  youtubeSourceData,
} from '../test/fixtures';
import { CommandPalette } from './CommandPalette';
import { HoverPreviewProvider } from './HoverPreviewContext';

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

/**
 * `HoverPreviewProvider` wraps the router content — `PaletteLinkRow` (palette-
 * rich-rows slice) now calls `useHoverPreview()` on hover, mirroring
 * `AppFrame.tsx`'s real hoisted provider (see that component's doc comment:
 * the provider now wraps both `<main>` and `<CommandPalette>`), so every test
 * in this file needs the same context ancestor or that hook throws.
 */
function wrapper({ children, route = '/' }: { children: ReactNode; route?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <HoverPreviewProvider>{children}</HoverPreviewProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function pressCmdK() {
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
}

/**
 * A full `SettingsMap` fixture for `GET /api/settings` mocks, with every
 * plugin's `palette` flag defaulted `true` (so `mockFetchByPath`'s
 * `/api/settings` route reflects the app's real optimistic-default shape,
 * not an empty stub) — tests override just the one plugin's `palette`
 * field under test via `plugins` deep-merge-by-key.
 */
function settingsWithPlugins(overrides: Partial<SettingsMap['plugins']> = {}): SettingsMap {
  return {
    theme: 'system',
    trashPurgeDays: 30,
    mcpAccess: true,
    linkPreviewImages: true,
    plugins: {
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: true, hover: true, palette: true },
      ...overrides,
    },
  };
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

  /**
   * Perf regression guard (dedupe-api-calls slice, unit 1): `CommandPalette`
   * is mounted PERMANENTLY at the app root (`AppFrame.tsx`), so if its data
   * hooks (`usePaletteResults`, buried inside the pre-split component) ran
   * unconditionally, EVERY page would fire a phantom `/api/links` or
   * `/api/trash` fetch even while the palette is closed. Builds a minimal
   * `palette` stub (matching `useCommandPalette()`'s return shape) with
   * `open: false` rather than going through the real hook + ⌘K, so this test
   * asserts the CLOSED state directly without a keypress ever flipping it
   * open. Then flips the SAME stub to `open: true` and re-renders to confirm
   * the inner does mount and does fetch once open — proving the wrapper's
   * gate, not just an absence of setup.
   */
  describe('closed-state fetch gating (perf: CommandPaletteInner only mounts when open)', () => {
    function paletteStub(open: boolean) {
      return {
        open,
        openPalette: vi.fn(),
        closePalette: vi.fn(),
        q: '',
        setQ: vi.fn(),
        debouncedQ: '',
        parsed: { text: '' },
        parsedDebounced: { text: '' },
        activeIndex: 0,
        setActiveIndex: vi.fn(),
        moveActive: vi.fn(),
        inputRef: { current: null },
      };
    }

    it('fires no /api/links or /api/trash fetch while closed', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      render(<CommandPalette palette={paletteStub(false)} />, { wrapper });
      // No fetch of any kind — a closed palette shouldn't even subscribe to
      // `useTags`, let alone the link/trash data hooks.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches once flipped open (the gate lifts, not just permanently withheld)', async () => {
      mockFetchByPath({ '/api/tags': { tags: [] }, '/api/links': { links: [] } });
      render(<CommandPalette palette={paletteStub(true)} />, { wrapper });
      await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
      await waitFor(() => expect(fetch).toHaveBeenCalled());
    });
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
            <HoverPreviewProvider>
              <Harness />
            </HoverPreviewProvider>
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

      // Scoped to the results `listbox` (not `screen` directly): the sole
      // result becomes cmdk's active row on mount, which now (palette-
      // keyboard-hover slice) opens the shared hover popover for it too —
      // the popover renders the SAME title text as the row, so an
      // unscoped `screen.getByText` would find two matches once the
      // popover's open. Scoping to the listbox keeps this test about the
      // list content, not the popover (covered separately below).
      const listbox = screen.getByRole('listbox');
      fireEvent.change(input, { target: { value: 're' } });
      await waitFor(() => expect(within(listbox).getByText('Stale but real')).toBeDefined(), {
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
      expect(within(listbox).getByText('Stale but real')).toBeDefined();
      expect(within(listbox).queryByText('No results')).toBeNull();

      // Resolve the second query — the stale row is replaced by the real one.
      resolveSecond?.(jsonResponse({ results: [] }));
      await waitFor(() => expect(within(listbox).getByText('No results')).toBeDefined(), {
        timeout: 2000,
      });
      expect(within(listbox).queryByText('Stale but real')).toBeNull();
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

  /**
   * `PaletteLinkRow`'s inline source-line (`CommandPalette.tsx`) — the HN
   * "N points · N comments" and Twitter tweet-text lines, gated per plugin by
   * `palettePluginOn`/`isPaletteSurfaceOn` off the SAME `palette` flag
   * (`SettingsMap['plugins'].<source>.palette`) `paletteSurface.test.ts`
   * already unit-tests in isolation — these tests exercise the gate wired
   * into the real row via `useSettings()` + a mocked `GET /api/settings`,
   * mirroring `LinkRow.test.tsx`'s "HN/Twitter inline plugin gate" blocks for
   * the library row. `mockFetchByPath` needs an explicit `/api/settings`
   * route here (the other describe blocks in this file never seed one,
   * relying on `useSettings()`'s loading-state `?? true` optimistic default).
   */
  describe('PaletteLinkRow inline source-line gating (palette flag)', () => {
    it('shows the HN "points · comments" inline line when plugins.hacker_news.palette is true', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'hn1', title: 'HN story', sourceData: hackerNewsSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'hn' } });
      await waitFor(() => expect(screen.getByText('HN story')).toBeDefined(), { timeout: 2000 });
      await waitFor(() => expect(screen.getByText('342 points · 128 comments')).toBeDefined(), {
        timeout: 2000,
      });
    });

    it('hides the HN inline line when plugins.hacker_news.palette is false (row still renders)', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          hacker_news: { enabled: true, inline: true, hover: true, palette: false },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'hn2', title: 'HN story off', sourceData: hackerNewsSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'hn' } });
      await waitFor(() => expect(screen.getByText('HN story off')).toBeDefined(), {
        timeout: 2000,
      });
      // Give the settings query room to resolve before asserting an absence
      // (a false negative here would just mean "hasn't loaded yet").
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText('342 points · 128 comments')).toBeNull();
    });

    it('shows the tweet-text inline line when plugins.twitter.palette is true', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'tw1', title: 'A tweet', sourceData: twitterSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'tw' } });
      await waitFor(() => expect(screen.getByText('A tweet')).toBeDefined(), { timeout: 2000 });
      await waitFor(
        () =>
          expect(
            screen.getByText('Just shipped a new feature — thrilled with how it turned out.'),
          ).toBeDefined(),
        { timeout: 2000 },
      );
    });

    it('hides the tweet-text inline line when plugins.twitter.palette is false (row still renders)', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: false },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'tw2', title: 'A tweet off', sourceData: twitterSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'tw' } });
      await waitFor(() => expect(screen.getByText('A tweet off')).toBeDefined(), {
        timeout: 2000,
      });
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(
        screen.queryByText('Just shipped a new feature — thrilled with how it turned out.'),
      ).toBeNull();
    });

    it('a YouTube result (hover-only source) renders no inline line at all — title/domain only', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins(),
        '/api/links/search': {
          results: [
            {
              ...makeLink({
                id: 'yt1',
                title: 'A video',
                url: 'https://youtube.com/watch?v=abc',
                sourceData: youtubeSourceData,
              }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'vid' } });
      await waitFor(() => expect(screen.getByText('A video')).toBeDefined(), { timeout: 2000 });
      expect(screen.getByText('youtube.com')).toBeDefined();
      // No HN/Twitter inline text, and no plain URL-ish inline artifact — the
      // row is exactly title + domain, hover-only.
      expect(screen.queryByText(/points ·/)).toBeNull();
      expect(screen.queryByText(youtubeSourceData.channel)).toBeNull();
    });

    it('a GitHub result (hover-only source) renders no inline line at all — title/domain only', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins(),
        '/api/links/search': {
          results: [
            {
              ...makeLink({
                id: 'gh1',
                title: 'A repo',
                url: 'https://github.com/owner/repo',
                sourceData: githubSourceData,
              }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'repo' } });
      await waitFor(() => expect(screen.getByText('A repo')).toBeDefined(), { timeout: 2000 });
      expect(screen.getByText('github.com')).toBeDefined();
      expect(screen.queryByText(/points ·/)).toBeNull();
      expect(
        screen.queryByText('Reference implementations for the Model Context Protocol'),
      ).toBeNull();
    });
  });

  /**
   * The hover-preview trigger wired into `PaletteLinkRow` (`handleEnter`,
   * `CommandPalette.tsx`) — mirrors `LinkRow.test.tsx`'s "LinkRow hover
   * preview" describe block's `matchMedia` handling exactly: jsdom's
   * `matchMedia` stub (`test-setup.ts`) defaults every query's `matches` to
   * `false`, which makes `isHoverCapable()` read `false` and forces
   * `scheduleShow`'s `suppress: true` path (`handleEnter`'s
   * `!isHoverCapable()` OR-branch) regardless of the `palette` flag — these
   * tests stub `window.matchMedia` so `(hover: hover)` reads `true`, matching
   * a real desktop mouse, so `suppress` is driven ONLY by the `palette` gate
   * under test.
   */
  describe('PaletteLinkRow hover-preview gating (palette flag)', () => {
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(hover: hover)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof matchMedia;
    });

    afterEach(() => {
      vi.useRealTimers();
      window.matchMedia = originalMatchMedia;
    });

    it('hovering a twitter row with palette:true opens the hover card after the show delay', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'hov1', title: 'Hover me', sourceData: twitterSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'hover' } });
      await waitFor(() => expect(screen.getByText('Hover me')).toBeDefined(), { timeout: 2000 });
      // Let the settings fetch resolve so `surfaceOn` reflects the real
      // (not still-loading-optimistic) value before hovering.
      await act(async () => {
        await Promise.resolve();
      });

      // `PaletteLinkRow`'s hover handlers live on its own outer `<span
      // ref={rowRef}>` — the SOLE child of the `[role="option"]`
      // `Command.Item` — not on the option element itself; React's
      // `onMouseEnter` doesn't bubble the way a native `mouseover` would, so
      // the event must be fired on that inner span directly, mirroring
      // `LinkRow.test.tsx`'s `fireEvent.mouseEnter(anchor)` (its own
      // handler-bearing element).
      const row = screen.getByText('Hover me').closest('[role="option"]') as HTMLElement;
      fireEvent.mouseEnter(row.firstElementChild as HTMLElement);
      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(document.querySelector('.silo-popover')).not.toBeNull();
    });

    it('hovering a twitter row with palette:false never opens the hover card', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: false },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'hov2', title: 'No hover here', sourceData: twitterSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'hover' } });
      await waitFor(() => expect(screen.getByText('No hover here')).toBeDefined(), {
        timeout: 2000,
      });
      await act(async () => {
        await Promise.resolve();
      });

      const row = screen.getByText('No hover here').closest('[role="option"]') as HTMLElement;
      fireEvent.mouseEnter(row.firstElementChild as HTMLElement);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(document.querySelector('.silo-popover')).toBeNull();
    });
  });

  /**
   * Keyboard-nav hover (palette-keyboard-hover slice, Task 2's `activeValue`
   * effect in `CommandPaletteInner`): the controlled `<Command value=
   * onValueChange=>` means cmdk echoes its OWN active-item state (arrow keys,
   * AND cmdk auto-selecting the first row on mount) back into `activeValue`,
   * which drives the same `scheduleShow`/`dismissAll` + `palettePluginOn` gate
   * as the mouse path — but unconditionally (no `isHoverCapable()` check; see
   * that effect's doc comment). Two ways this is proven reliable in jsdom
   * without a brittle synthetic cmdk internals reach-around:
   *
   * 1. cmdk selects the FIRST item as active the instant results mount (the
   *    "flicker fix" describe block above already leans on this, see its own
   *    comment: "the sole result becomes cmdk's active row on mount"), so
   *    rendering with results already exercises the effect with zero
   *    keypresses.
   * 2. Real `ArrowDown`/`ArrowUp` keydowns on the input (already proven to
   *    move `aria-selected` in the "ArrowDown/ArrowUp move the active option"
   *    test above) reliably re-fire `onValueChange`, so arrowing from row A to
   *    row B is exercised directly, not inferred.
   *
   * Reuses the same `matchMedia` stub as the sibling hover-gating block above
   * for parity with the mouse-path tests, even though the keyboard effect
   * itself never calls `isHoverCapable()` — it's inert here (no mouse handler
   * runs), included only so this block's setup matches its neighbor.
   */
  describe('keyboard-nav palette hover gating (activeValue effect)', () => {
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(hover: hover)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof matchMedia;
    });

    afterEach(() => {
      vi.useRealTimers();
      window.matchMedia = originalMatchMedia;
    });

    it('cmdk auto-selecting the first (twitter) row on mount opens the hover card when plugins.twitter.palette is true — no keypress required', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'kb1', title: 'Keyboard tweet', sourceData: twitterSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'keyboard' } });
      await waitFor(() => expect(screen.getByText('Keyboard tweet')).toBeDefined(), {
        timeout: 2000,
      });
      // cmdk already marked this sole row active on mount — no ArrowDown
      // needed for `activeValue` to have been set at least once.
      expect(optionRowFor('Keyboard tweet').getAttribute('aria-selected')).toBe('true');

      // The effect's `scheduleShow` runs on its own show-delay timer — advance
      // fake timers the same amount the sibling mouse-hover tests do. The
      // keyboard effect applies the same `isHoverCapable()` guard as the mouse
      // path (this block's `matchMedia` stub reports `(hover: hover)` true, so
      // the guard passes — the touch-guard case is its own test below).
      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(document.querySelector('.silo-popover')).not.toBeNull();
    });

    it('does NOT open the hover card on a coarse/touch pointer (isHoverCapable() false) even for an enabled twitter row', async () => {
      // Regression (review: ce-correctness): cmdk's `onValueChange` fires on
      // POINTER MOVE as well as arrow keys (`disablePointerSelection` defaults
      // false), so the keyboard-hover effect must honor the same
      // `isHoverCapable()` touch guard the mouse `handleEnter` uses — otherwise
      // a tap on a touch device would open a card the pointer path suppresses.
      // Here `(hover: hover)` reports FALSE (coarse pointer), so even the
      // gate-enabled, auto-active twitter row must NOT show a card.
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false, // no hover capability (touch/coarse pointer)
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof matchMedia;
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'kbtouch', title: 'Touch tweet', sourceData: twitterSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'touch' } });
      await waitFor(() => expect(screen.getByText('Touch tweet')).toBeDefined(), { timeout: 2000 });
      expect(optionRowFor('Touch tweet').getAttribute('aria-selected')).toBe('true');

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(document.querySelector('.silo-popover')).toBeNull();
    });

    it('cmdk auto-selecting the first (twitter) row on mount does NOT open the hover card when plugins.twitter.palette is false (dismissAll path)', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: false },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'kb2', title: 'Gated tweet', sourceData: twitterSourceData }),
              rank: 1,
            },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'gated' } });
      await waitFor(() => expect(screen.getByText('Gated tweet')).toBeDefined(), {
        timeout: 2000,
      });
      expect(optionRowFor('Gated tweet').getAttribute('aria-selected')).toBe('true');

      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(document.querySelector('.silo-popover')).toBeNull();
    });

    it('arrowing off a gate-enabled twitter row onto a plain link row moves the card, then arrowing onto a tag suggestion dismisses it', async () => {
      mockFetchByPath({
        '/api/tags': { tags: [{ name: 'frontend', count: 2 }] },
        '/api/settings': settingsWithPlugins({
          twitter: { enabled: true, inline: true, hover: true, palette: true },
        }),
        '/api/links/search': {
          results: [
            {
              ...makeLink({ id: 'kb3', title: 'First tweet', sourceData: twitterSourceData }),
              rank: 1,
            },
            { ...makeLink({ id: 'kb4', title: 'Second link' }), rank: 1 },
          ],
        },
      });
      await renderPalette();
      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'link' } });
      await waitFor(() => expect(screen.getByText('First tweet')).toBeDefined(), {
        timeout: 2000,
      });
      await waitFor(() => expect(screen.getByText('Second link')).toBeDefined(), {
        timeout: 2000,
      });

      // Row 1 (twitter, palette:true) is active on mount — card shows.
      expect(optionRowFor('First tweet').getAttribute('aria-selected')).toBe('true');
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(document.querySelector('.silo-popover')).not.toBeNull();

      // ArrowDown onto the plain link row: real keyboard nav re-fires
      // onValueChange, the effect re-runs for the new activeValue, and the
      // card follows (generic links are ungated per `palettePluginOn`).
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(optionRowFor('Second link').getAttribute('aria-selected')).toBe('true');
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(document.querySelector('.silo-popover')).not.toBeNull();

      // Now switch the query to surface a TAG suggestion row instead —
      // arrowing onto (mounting active on) a tag row must dismiss the card,
      // since `resultByValue.get(activeValue)?.kind !== 'link'`.
      fireEvent.change(input, { target: { value: '#front' } });
      await waitFor(() => expect(screen.getByText('frontend')).toBeDefined(), { timeout: 2000 });
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(document.querySelector('.silo-popover')).toBeNull();
    });
  });
});
