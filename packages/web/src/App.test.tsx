import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderApp(initialEntries: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('App routing', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/links')) {
          return Promise.resolve(jsonResponse({ links: [] }));
        }
        return Promise.resolve(jsonResponse({ live: 128, trash: 2, purgeWindowDays: 30 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Library view (and its active nav item) at /', async () => {
    renderApp(['/']);
    // "128" appears twice now (v3): the sidebar's Library count AND the new
    // content-header count next to the "Library" title.
    await waitFor(() => expect(screen.getAllByText('128').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('Nothing kept yet.')).toBeDefined());
    const libraryLink = screen.getByRole('link', { name: /library/i });
    expect(libraryLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders the Trash view + active nav item at /trash', async () => {
    renderApp(['/trash']);
    await waitFor(() => expect(screen.getByText(/Trash — coming soon/i)).toBeDefined());
    const trashLink = screen.getByRole('link', { name: /trash/i });
    expect(trashLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders the tag-scoped Library view (title + empty state) at /tags/:name', async () => {
    renderApp(['/tags/mcp']);
    await waitFor(() => expect(screen.getByText('#mcp')).toBeDefined());
    await waitFor(() => expect(screen.getByText('No links tagged #mcp yet.')).toBeDefined());
  });

  it('renders the Settings view at /settings', async () => {
    renderApp(['/settings']);
    await waitFor(() => expect(screen.getByText(/Settings — coming soon/i)).toBeDefined());
  });

  it('renders a calm not-found view for an unknown path', async () => {
    renderApp(['/nope']);
    await waitFor(() => expect(screen.getByText(/Not found/i)).toBeDefined());
  });
});
