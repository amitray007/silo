import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SettingsProvider } from './SettingsContext';
import { Sidebar } from './Sidebar';

function tagCounts(names: string[]): { name: string; count: number }[] {
  return names.map((name, i) => ({ name, count: names.length - i }));
}

/** Count rendered tag rows (links to `/tags/…`) — the tag name is split from
 * its `#` span now, so a text regex on `#tag` no longer matches a whole row. */
function tagRowCount(): number {
  return screen.queryAllByRole('link').filter((el) => el.getAttribute('href')?.startsWith('/tags/'))
    .length;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The `/api/auth/check` response `AuthProvider`'s mount-time check receives.
 * Every existing Sidebar test in this file predates the auth cookie upgrade
 * and configures `fetch` assuming no gate is in front of the sidebar at
 * all — `AUTH_OPEN` (`authRequired: false`, `'open'` state) preserves that
 * for every test that doesn't care about auth. Only the "Log out" describe
 * block below opts into `AUTH_AUTHED` to exercise the gated row.
 */
const AUTH_OPEN = { authRequired: false };
const AUTH_AUTHED = { authRequired: true, authenticated: true };

/**
 * Wraps a per-test `fetch` router (`appFetch`, configured via
 * `vi.mocked(fetch)` exactly as before this file added `AuthProvider`) so
 * `/api/auth/check` is answered out-of-band with `authResponse` — every
 * OTHER URL still goes to whatever the test's own `mockImplementation`/
 * `mockResolvedValue` set up. Rendering `Sidebar` now requires `AuthProvider`
 * (it calls `useAuth()` for the Log out row), and `AuthProvider` fires its
 * own mount-time `GET /api/auth/check` that the app-level fetch routers in
 * this file don't know about — this interception keeps every pre-existing
 * test's router untouched rather than editing 15 call sites to add an
 * `/api/auth/check` branch each.
 */
function stubFetchWithAuth(authResponse: unknown) {
  const appFetch = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/auth/check')) {
        return Promise.resolve(jsonResponse(authResponse));
      }
      return appFetch(input, init);
    }),
  );
  return appFetch;
}

function renderSidebar(initialEntries: string[] = ['/'], onOpenSearch?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <AuthProvider>
            <SettingsProvider>
              {onOpenSearch ? <Sidebar onOpenSearch={onOpenSearch} /> : <Sidebar />}
            </SettingsProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    // `vi.mocked(fetch)` below refers to this appFetch router — every
    // existing test in this file configures it exactly as it did before
    // `AuthProvider` was added (see `stubFetchWithAuth`'s doc comment).
    vi.stubGlobal('fetch', stubFetchWithAuth(AUTH_OPEN));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows compact-formatted Library, Trash, and tag counts (count-desc order)', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        // Library and Trash counts render in the sidebar.
        return Promise.resolve(jsonResponse({ live: 128, trash: 1500, purgeWindowDays: 30 }));
      }
      if (url === '/api/tags') {
        return Promise.resolve(
          jsonResponse({
            tags: [
              { name: 'ai', count: 12000 },
              { name: 'design', count: 17 },
              { name: 'mcp', count: 7 },
              { name: 'empty', count: 0 },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderSidebar();

    expect(screen.getByText('silo')).toBeDefined();
    // Trash count is compact-formatted; Library's raw count is shown beside Library.
    await waitFor(() => expect(screen.getByText('128')).toBeDefined());
    await waitFor(() => expect(screen.getByText('1.5k')).toBeDefined());

    // The `#` is its own span (spacing fix), so the tag name is a separate text
    // node — query by name and read tag rows by role for order. Tag counts are
    // compact too (12000 → 12k).
    await waitFor(() => expect(screen.getByText('ai')).toBeDefined());
    const tagNames = ['ai', 'design', 'mcp', 'empty'].map(
      (name) => screen.getByRole('link', { name: new RegExp(name, 'i') }).textContent,
    );
    expect(tagNames).toEqual(['#ai12k', '#design17', '#mcp7', '#empty']);
    expect(screen.getByText('12k')).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();

    expect(screen.getByRole('link', { name: /settings/i })).toBeDefined();
  });

  it('renders v3 icons (svg) for Library, Trash, and Settings — but not for tags', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 3, trash: 1, purgeWindowDays: 30 }));
      }
      if (url === '/api/tags') {
        return Promise.resolve(jsonResponse({ tags: [{ name: 'ai', count: 2 }] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderSidebar();

    await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

    const libraryLink = screen.getByRole('link', { name: /library/i });
    const trashLink = screen.getByRole('link', { name: /trash/i });
    const settingsLink = screen.getByRole('link', { name: /settings/i });
    const tagLink = screen.getByRole('link', { name: /#\s*ai/i });

    expect(libraryLink.querySelector('svg')).not.toBeNull();
    expect(trashLink.querySelector('svg')).not.toBeNull();
    expect(settingsLink.querySelector('svg')).not.toBeNull();
    expect(tagLink.querySelector('svg')).toBeNull();
  });

  it('marks the current route active via aria-current', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));

    renderSidebar(['/trash']);

    await waitFor(() => {
      const trashLink = screen.getByRole('link', { name: /trash/i });
      expect(trashLink.getAttribute('aria-current')).toBe('page');
    });
    const libraryLink = screen.getByRole('link', { name: /library/i });
    expect(libraryLink.getAttribute('aria-current')).toBeNull();
  });

  it('an active tag row gets the same filled --surface-active box as an active Library/Trash row', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/tags') {
        return Promise.resolve(jsonResponse({ tags: tagCounts(['ai', 'design']) }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderSidebar(['/tags/ai']);

    await waitFor(() => {
      const aiLink = screen.getByRole('link', { name: /ai/i });
      expect(aiLink.getAttribute('aria-current')).toBe('page');
      expect(aiLink.style.background).toBe('var(--surface-active)');
      expect(aiLink.style.boxShadow).toBe('var(--elev-1), inset 0 0 0 1px var(--line)');
    });
    const designLink = screen.getByRole('link', { name: /design/i });
    expect(designLink.getAttribute('aria-current')).toBeNull();
    expect(designLink.style.background).toBe('');
  });

  it('does not crash and renders no tag rows (but keeps the Tags tools) when the tags request errors', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/tags') {
        return Promise.resolve(jsonResponse({ error: 'internal_error', message: 'oops' }, 500));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderSidebar();

    await waitFor(() => expect(screen.getByText('silo')).toBeDefined());
    // v3's Tags header + find/+new-tag tools are always present (Silo-v3.html
    // never gates them on having any tags) — only the tag rows themselves are
    // empty when the fetch errors.
    expect(screen.getByText('Tags')).toBeDefined();
    expect(screen.queryAllByText(/^#/)).toHaveLength(0);
  });

  it('renders calmly with no data yet (loading state)', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    renderSidebar();
    expect(screen.getByText('silo')).toBeDefined();
    expect(screen.getByRole('link', { name: /library/i })).toBeDefined();
  });

  it('renders no amber (--mark) chrome on the active nav item', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
    renderSidebar(['/']);
    await waitFor(() => {
      const libraryLink = screen.getByRole('link', { name: /library/i });
      expect(libraryLink.style.color).not.toContain('--mark');
      expect(libraryLink.style.background).not.toContain('--mark');
    });
  });

  describe('Search nav row (rewritten to render through shared NavItem — parity with Library/Trash)', () => {
    it('renders as a button (not a link — no /search route) that fires onOpenSearch', async () => {
      const onOpenSearch = vi.fn();
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      renderSidebar(['/'], onOpenSearch);

      const searchButton = screen.getByRole('button', { name: /search/i });
      expect(searchButton.tagName).toBe('BUTTON');
      fireEvent.click(searchButton);
      expect(onOpenSearch).toHaveBeenCalledTimes(1);
    });

    it('renders the same icon size, font size/weight, and padding as the Library row', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ live: 3, trash: 0, purgeWindowDays: 30 }));
      renderSidebar();

      const searchButton = screen.getByRole('button', { name: /search/i });
      const libraryLink = await screen.findByRole('link', { name: /library/i });

      expect(searchButton.style.padding).toBe(libraryLink.style.padding);
      expect(searchButton.style.fontSize).toBe(libraryLink.style.fontSize);
      expect(searchButton.style.fontWeight).toBe(libraryLink.style.fontWeight);
      expect(searchButton.className).toBe(libraryLink.className);

      const searchIcon = searchButton.querySelector('svg');
      const libraryIcon = libraryLink.querySelector('svg');
      expect(searchIcon?.getAttribute('width')).toBe('18');
      expect(searchIcon?.getAttribute('width')).toBe(libraryIcon?.getAttribute('width'));
    });

    it('renders the "⌘K" shortcut chip in the same right-aligned meta column as counts', async () => {
      // trash 2 anchors the load (Library no longer renders a count) and
      // formats compactly as "2".
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ live: 3, trash: 2, purgeWindowDays: 30 }));
      renderSidebar();

      await waitFor(() => expect(screen.getByText('2')).toBeDefined());
      expect(screen.getByText('⌘')).toBeDefined();
      expect(screen.getByText('K')).toBeDefined();
    });
  });

  describe('⌕ find-a-tag', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/tags') {
          return Promise.resolve(jsonResponse({ tags: tagCounts(['ai', 'design', 'mcp']) }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
    });

    it('toggles the filter input and filters the tag list case-insensitively', async () => {
      renderSidebar();
      await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

      expect(screen.queryByPlaceholderText('Find tag')).toBeNull();

      fireEvent.click(screen.getByTitle('Find a tag'));
      const input = screen.getByPlaceholderText('Find tag');
      expect(input).toBeDefined();

      fireEvent.change(input, { target: { value: 'DES' } });
      expect(screen.getByText('design')).toBeDefined();
      expect(screen.queryByText('ai')).toBeNull();
      expect(screen.queryByText('mcp')).toBeNull();

      // Toggling closed again hides the input.
      fireEvent.click(screen.getByTitle('Find a tag'));
      expect(screen.queryByPlaceholderText('Find tag')).toBeNull();
    });
  });

  describe('scrollable tag list (redesign — no more "+N more" truncation)', () => {
    it('renders every tag, however many, inside the scroll region — nothing hidden behind a click', async () => {
      const names = Array.from({ length: 13 }, (_, i) => `tag${i}`);
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/tags') {
          return Promise.resolve(jsonResponse({ tags: tagCounts(names) }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      renderSidebar();
      await waitFor(() => expect(screen.getByText('tag0')).toBeDefined());

      expect(tagRowCount()).toBe(13);
      expect(screen.queryByText(/more$/)).toBeNull();
      expect(screen.queryByText('Show less')).toBeNull();
    });

    it('puts the tag rows inside the soft-scrollbar, fixed-max-height scroll container', async () => {
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/tags') {
          return Promise.resolve(jsonResponse({ tags: tagCounts(['ai', 'design', 'mcp']) }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const { container } = renderSidebar();
      await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

      const scrollRegion = container.querySelector('.silo-tag-scroll');
      expect(scrollRegion).not.toBeNull();
      expect(scrollRegion?.contains(screen.getByRole('link', { name: /ai/i }))).toBe(true);
    });
  });

  describe('+ new tag', () => {
    /** GET `/api/counts` + `/api/tags` (one tag: `#ai`) and a POST `/api/tags` stub — shared by every "+ new tag" test. */
    function mockOneTagAndCreate() {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/tags' && init?.method === 'POST') {
          return Promise.resolve(jsonResponse({ name: 'newtag' }, 201));
        }
        if (url === '/api/tags') {
          return Promise.resolve(jsonResponse({ tags: tagCounts(['ai']) }));
        }
        throw new Error(`unexpected fetch: ${url} ${init?.method}`);
      });
      return fetchMock;
    }

    function findPostCall(fetchMock: ReturnType<typeof mockOneTagAndCreate>) {
      return fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
    }

    it('click opens an inline input; Enter creates the tag via useCreateTag and closes', async () => {
      const fetchMock = mockOneTagAndCreate();

      renderSidebar();
      await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

      fireEvent.click(screen.getByRole('button', { name: /new tag/i }));
      const input = screen.getByPlaceholderText('Tag name');
      fireEvent.change(input, { target: { value: 'newtag' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(findPostCall(fetchMock)).toBeDefined());
      const postCall = findPostCall(fetchMock);
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ name: 'newtag' });

      expect(screen.queryByPlaceholderText('Tag name')).toBeNull();
      expect(screen.getByRole('button', { name: /new tag/i })).toBeDefined();
    });

    it('Escape closes the input without creating a tag', async () => {
      const fetchMock = mockOneTagAndCreate();

      renderSidebar();
      await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

      fireEvent.click(screen.getByRole('button', { name: /new tag/i }));
      const input = screen.getByPlaceholderText('Tag name');
      fireEvent.change(input, { target: { value: 'abandoned' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByPlaceholderText('Tag name')).toBeNull();
      expect(findPostCall(fetchMock)).toBeUndefined();
    });

    it('is a no-op for an empty value', async () => {
      const fetchMock = mockOneTagAndCreate();

      renderSidebar();
      await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

      fireEvent.click(screen.getByRole('button', { name: /new tag/i }));
      const input = screen.getByPlaceholderText('Tag name');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(screen.queryByPlaceholderText('Tag name')).toBeNull();
      expect(findPostCall(fetchMock)).toBeUndefined();
    });

    it('a failed create keeps the input open with the typed value and shows an inline error', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/tags' && init?.method === 'POST') {
          return Promise.resolve(jsonResponse({ error: 'internal_error', message: 'oops' }, 500));
        }
        if (url === '/api/tags') {
          return Promise.resolve(jsonResponse({ tags: tagCounts(['ai']) }));
        }
        throw new Error(`unexpected fetch: ${url} ${init?.method}`);
      });

      renderSidebar();
      await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

      fireEvent.click(screen.getByRole('button', { name: /new tag/i }));
      const input = screen.getByPlaceholderText('Tag name');
      fireEvent.change(input, { target: { value: 'newtag' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(screen.getByText("Couldn't create — try again")).toBeDefined());
      // The input stays open with the value intact — a failed create must
      // never look identical to a successful one.
      expect(screen.getByPlaceholderText('Tag name')).toHaveProperty('value', 'newtag');
    });
  });

  it('orders sections brand → Library/Trash → divider → Tags → divider → Settings, with Settings no longer bottom-pinned', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 1, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/tags') {
        return Promise.resolve(jsonResponse({ tags: tagCounts(['ai', 'design']) }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { container } = renderSidebar();
    await waitFor(() => expect(screen.getByText('ai')).toBeDefined());

    const nav = container.querySelector('nav[aria-label="Sidebar"]');
    expect(nav).not.toBeNull();

    // Order of top-level children: brand, Library, Trash, divider, Tags
    // section, divider, Settings.
    const children = Array.from(nav?.children ?? []) as HTMLElement[];
    const settingsLink = screen.getByRole('link', { name: /settings/i });
    const tagsHeader = screen.getByText('Tags');

    const dividerIndices = children
      .map((el, i) => ({ el, i }))
      .filter(({ el }) => el.style.borderTop === '1px solid var(--line)')
      .map(({ i }) => i);
    const settingsIndex = children.findIndex((el) => el.contains(settingsLink));
    const tagsSectionIndex = children.findIndex((el) => el.contains(tagsHeader));

    // Two dividers: one above Tags, one between Tags and Settings.
    expect(dividerIndices).toHaveLength(2);
    const [firstDividerIndex, secondDividerIndex] = dividerIndices;
    expect(firstDividerIndex).toBeLessThan(tagsSectionIndex);
    expect(tagsSectionIndex).toBeLessThan(secondDividerIndex as number);
    expect(secondDividerIndex).toBeLessThan(settingsIndex);
    // Settings is the very last top-level child now — no flex spacer
    // pinning it to the bottom anymore (that spacer used to be the last
    // child, after Settings' own NavItemLink).
    expect(settingsIndex).toBe(children.length - 1);
  });

  it('renders the Tags header + tools calmly with zero tags (not gated on tag count)', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
      }
      if (url === '/api/tags') {
        return Promise.resolve(jsonResponse({ tags: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderSidebar();

    await waitFor(() => expect(screen.getByText('Tags')).toBeDefined());
    expect(screen.getByText('Tags').parentElement?.style.padding).toBe(
      'var(--s-0-5) var(--s2-5) var(--s1) calc(var(--s2-5) + 3px)',
    );
    expect(screen.getByRole('button', { name: /new tag/i })).toBeDefined();
    expect(screen.queryAllByText(/^#/)).toHaveLength(0);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  describe('Log out row (auth cookie upgrade, Unit 6)', () => {
    /** Every test in this block answers `/api/counts`/`/api/tags` the same minimal way — only the auth response varies. */
    function stubAppData(appFetch: ReturnType<typeof vi.fn>) {
      appFetch.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/tags') {
          return Promise.resolve(jsonResponse({ tags: [] }));
        }
        if (url === '/api/logout') {
          return Promise.resolve(jsonResponse({ ok: true }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
    }

    it('shows no Log out row when auth is "open" (no password configured)', async () => {
      // beforeEach already stubs AUTH_OPEN; just supply the app data.
      stubAppData(vi.mocked(fetch));
      renderSidebar();

      await waitFor(() => expect(screen.getByText('silo')).toBeDefined());
      expect(screen.queryByRole('button', { name: /log out/i })).toBeNull();
    });

    it('shows the Log out row once a session is authed', async () => {
      const appFetch = stubFetchWithAuth(AUTH_AUTHED);
      stubAppData(appFetch);
      renderSidebar();

      const logoutButton = await screen.findByRole('button', { name: /log out/i });
      expect(logoutButton.tagName).toBe('BUTTON');
    });

    it('clicking Log out calls useAuth().logout() (POSTs /api/logout)', async () => {
      const appFetch = stubFetchWithAuth(AUTH_AUTHED);
      stubAppData(appFetch);
      renderSidebar();

      const logoutButton = await screen.findByRole('button', { name: /log out/i });
      fireEvent.click(logoutButton);

      await waitFor(() =>
        expect(appFetch).toHaveBeenCalledWith('/api/logout', expect.objectContaining({})),
      );
    });

    it('renders the Log out row through the shared NavItem (settings variant — same look as Settings)', async () => {
      const appFetch = stubFetchWithAuth(AUTH_AUTHED);
      stubAppData(appFetch);
      renderSidebar();

      const logoutButton = await screen.findByRole('button', { name: /log out/i });
      const settingsLink = screen.getByRole('link', { name: /settings/i });

      expect(logoutButton.className).toBe(settingsLink.className);
      expect(logoutButton.style.padding).toBe(settingsLink.style.padding);
      expect(logoutButton.style.fontWeight).toBe(settingsLink.style.fontWeight);
      expect(logoutButton.querySelector('svg')).not.toBeNull();
    });
  });
});
