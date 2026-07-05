import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SettingsProvider } from './SettingsContext';
import { Sidebar } from './Sidebar';

function tagCounts(names: string[]): { name: string; count: number }[] {
  return names.map((name, i) => ({ name, count: names.length - i }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderSidebar(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <SettingsProvider>
            <Sidebar />
          </SettingsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Library/Trash counts and a NavItem per tag, count-desc order preserved', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/counts') {
        return Promise.resolve(jsonResponse({ live: 128, trash: 2, purgeWindowDays: 30 }));
      }
      if (url === '/api/tags') {
        return Promise.resolve(
          jsonResponse({
            tags: [
              { name: 'ai', count: 23 },
              { name: 'design', count: 17 },
              { name: 'mcp', count: 7 },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderSidebar();

    expect(screen.getByText('silo')).toBeDefined();
    await waitFor(() => expect(screen.getByText('128')).toBeDefined());
    expect(screen.getByText('2 · 30d')).toBeDefined();

    await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());
    const tagNames = screen
      .getAllByText(/^#/)
      .map((el) => el.textContent)
      .filter((text): text is string => text !== null);
    expect(tagNames).toEqual(['#ai', '#design', '#mcp']);
    expect(screen.getByText('23')).toBeDefined();
    expect(screen.getByText('17')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();

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

    await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());

    const libraryLink = screen.getByRole('link', { name: /library/i });
    const trashLink = screen.getByRole('link', { name: /trash/i });
    const settingsLink = screen.getByRole('link', { name: /settings/i });
    const tagLink = screen.getByRole('link', { name: /#ai/i });

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
      await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());

      expect(screen.queryByPlaceholderText('find tag')).toBeNull();

      fireEvent.click(screen.getByTitle('find a tag'));
      const input = screen.getByPlaceholderText('find tag');
      expect(input).toBeDefined();

      fireEvent.change(input, { target: { value: 'DES' } });
      expect(screen.getByText('#design')).toBeDefined();
      expect(screen.queryByText('#ai')).toBeNull();
      expect(screen.queryByText('#mcp')).toBeNull();

      // Toggling closed again hides the input.
      fireEvent.click(screen.getByTitle('find a tag'));
      expect(screen.queryByPlaceholderText('find tag')).toBeNull();
    });
  });

  describe('+N more truncation', () => {
    it('shows only the first 10 tags with a "+N more" toggle when there are more than 10', async () => {
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
      await waitFor(() => expect(screen.getByText('#tag0')).toBeDefined());

      expect(screen.getAllByText(/^#tag/)).toHaveLength(10);
      const more = screen.getByText('+3 more');
      expect(more).toBeDefined();

      fireEvent.click(more);
      expect(screen.getAllByText(/^#tag/)).toHaveLength(13);
      expect(screen.getByText('show less')).toBeDefined();

      fireEvent.click(screen.getByText('show less'));
      expect(screen.getAllByText(/^#tag/)).toHaveLength(10);
    });

    it('shows no "+N more" toggle when there are 10 or fewer tags', async () => {
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

      renderSidebar();
      await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());
      expect(screen.queryByText(/more$/)).toBeNull();
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
      await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());

      fireEvent.click(screen.getByText('+ new tag'));
      const input = screen.getByPlaceholderText('tag name');
      fireEvent.change(input, { target: { value: 'newtag' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(findPostCall(fetchMock)).toBeDefined());
      const postCall = findPostCall(fetchMock);
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({ name: 'newtag' });

      expect(screen.queryByPlaceholderText('tag name')).toBeNull();
      expect(screen.getByText('+ new tag')).toBeDefined();
    });

    it('Escape closes the input without creating a tag', async () => {
      const fetchMock = mockOneTagAndCreate();

      renderSidebar();
      await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());

      fireEvent.click(screen.getByText('+ new tag'));
      const input = screen.getByPlaceholderText('tag name');
      fireEvent.change(input, { target: { value: 'abandoned' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByPlaceholderText('tag name')).toBeNull();
      expect(findPostCall(fetchMock)).toBeUndefined();
    });

    it('is a no-op for an empty value', async () => {
      const fetchMock = mockOneTagAndCreate();

      renderSidebar();
      await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());

      fireEvent.click(screen.getByText('+ new tag'));
      const input = screen.getByPlaceholderText('tag name');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(screen.queryByPlaceholderText('tag name')).toBeNull();
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
      await waitFor(() => expect(screen.getByText('#ai')).toBeDefined());

      fireEvent.click(screen.getByText('+ new tag'));
      const input = screen.getByPlaceholderText('tag name');
      fireEvent.change(input, { target: { value: 'newtag' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(screen.getByText("couldn't create — try again")).toBeDefined());
      // The input stays open with the value intact — a failed create must
      // never look identical to a successful one.
      expect(screen.getByPlaceholderText('tag name')).toHaveProperty('value', 'newtag');
    });
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
    expect(screen.getByText('+ new tag')).toBeDefined();
    expect(screen.queryAllByText(/^#/)).toHaveLength(0);
    expect(screen.queryByText(/more$/)).toBeNull();
  });
});
