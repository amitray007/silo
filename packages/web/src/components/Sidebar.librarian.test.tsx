import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SettingsProvider } from './SettingsContext';
import { Sidebar } from './Sidebar';

const json = (body: unknown) => new Response(JSON.stringify(body));
function renderSidebar(librarian: { ready: boolean } | null, path = '/') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/check')) return json({ authRequired: false });
      if (url === '/api/ai')
        return json({ status: { enabled: true, features: librarian ? { librarian } : {} } });
      if (url === '/api/tags') return json({ tags: [] });
      if (url === '/api/feeds') return json({ feeds: [] });
      return json({ live: 0, trash: 0 });
    }),
  );
  render(
    <ThemeProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <SettingsProvider>
              <Sidebar />
            </SettingsProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

it('lists the Librarian under Library once it is ready, and marks it on its page', async () => {
  renderSidebar({ ready: true }, '/librarian');
  const link = await screen.findByRole('link', { name: 'Librarian' });
  expect(link.getAttribute('href')).toBe('/librarian');
  expect(link.getAttribute('aria-current')).toBe('page');
  const items = screen.getAllByRole('link').map((item) => item.textContent);
  expect(items.indexOf('Librarian')).toBe(
    items.findIndex((text) => text?.startsWith('Library')) + 1,
  );
});

it('has no Librarian entry while the Librarian is off or not ready', async () => {
  renderSidebar({ ready: false });
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/ai', expect.anything()));
  await screen.findByRole('link', { name: /Library/ });
  expect(screen.queryByRole('link', { name: 'Librarian' })).toBeNull();
});
