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
      vi.fn().mockResolvedValue(jsonResponse({ live: 128, trash: 2, purgeWindowDays: 30 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Library view (and its active nav item) at /', async () => {
    renderApp(['/']);
    await waitFor(() => expect(screen.getByText('128')).toBeDefined());
    expect(screen.getByText(/Library — coming soon/i)).toBeDefined();
    const libraryLink = screen.getByRole('link', { name: /library/i });
    expect(libraryLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders the Trash view + active nav item at /trash', async () => {
    renderApp(['/trash']);
    await waitFor(() => expect(screen.getByText(/Trash — coming soon/i)).toBeDefined());
    const trashLink = screen.getByRole('link', { name: /trash/i });
    expect(trashLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders the tag name at /tags/:name', async () => {
    renderApp(['/tags/mcp']);
    await waitFor(() => expect(screen.getByText(/#mcp — coming soon/i)).toBeDefined());
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
