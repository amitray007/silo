import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderSidebar(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
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

  it('does not crash and renders no Tags section when the tags request errors', async () => {
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
    expect(screen.queryByText('Tags')).toBeNull();
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
});
