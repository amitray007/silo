import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { CommandPalette } from './CommandPalette';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Routes fetch to a canned response by matching the request path prefix — the palette fires useTags/useSearchLinks/useLinksByTag/useInfiniteLinks concurrently, so a single mockResolvedValueOnce chain can't express "whichever fires first." A fresh Response is built per call (never a shared instance — Response bodies can only be consumed once). */
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

/** Renders `CommandPalette` behind a live `useCommandPalette()` instance so the real debounce timer and parse-on-every-render behavior are exercised, not a hand-built stand-in — the very fix under test (#3, raw-vs-debounced parse divergence) only exists if the real hook's timing is in play. Exposes an `openViaKeydown` helper so tests can drive ⌘K exactly like a real user. */
async function renderPalette() {
  const { useCommandPalette } = await import('../lib/useCommandPalette');
  function Harness() {
    const palette = useCommandPalette();
    return <CommandPalette palette={palette} />;
  }
  return render(<Harness />, { wrapper });
}

function pressCmdK() {
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
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

  it('Escape closes the palette (via ModalShell)', async () => {
    mockFetchByPath({ '/api/tags': { tags: [] }, '/api/links': { links: [] } });
    await renderPalette();
    pressCmdK();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ArrowDown/ArrowUp move the active option, wrapping at both ends', async () => {
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

    expect(input.getAttribute('aria-activedescendant')).toContain('a');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain('b');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain('a');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toContain('b');
  });

  describe('activeIndex clamping on an async results shrink (review fix #2)', () => {
    it('Enter still acts on a valid row after the result list shrinks WITHOUT a keystroke', async () => {
      // Two results at first (activeIndex moved to the second, index 1), then
      // the SAME query re-resolves (e.g. TanStack's own refetch/settle) with
      // only ONE result — activeIndex is never reset by a keystroke in this
      // scenario, so a real bug here would leave activeIndex=1 pointing past
      // the end of a 1-item array, and Enter would silently no-op.
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
          <Harness />
        </QueryClientProvider>,
      );

      pressCmdK();
      const input = await screen.findByRole('combobox');
      fireEvent.change(input, { target: { value: 'x' } });
      await waitFor(() => expect(screen.getByText('Link B')).toBeDefined(), { timeout: 2000 });

      // Move active to the SECOND row (index 1).
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input.getAttribute('aria-activedescendant')).toContain('b');

      // Now shrink the result set out from under the palette WITHOUT any
      // keystroke — invalidate + refetch, exactly like a live TanStack
      // refetch would.
      resultCount = 1;
      await act(async () => {
        await queryClient.invalidateQueries();
      });
      await waitFor(() => expect(screen.queryByText('Link B')).toBeNull(), { timeout: 2000 });

      // activeIndex must have clamped down to the new last (only) row — Enter
      // opens IT, not a no-op.
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(window.open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener');
    });
  });

  describe('raw-vs-debounced parse consistency (review fix #3)', () => {
    it('typing a trailing space that settles a #tag never fires an unscoped search in the settling window', async () => {
      // The regression: showTagSuggestions used to read the RAW (undebounced)
      // parse while the actual query args read the DEBOUNCED parse. Typing
      // "#frontend" then a trailing space settles the tag INSTANTLY in the
      // raw parse, but for up to the debounce window the debounced parse
      // could still lag — if the two disagree, the fired query is an
      // unscoped text search instead of the tag-scoped list. Asserts that
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
});
