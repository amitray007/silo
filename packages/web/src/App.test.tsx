import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
        // `AuthProvider`'s mount-time check — `authRequired: false` (no
        // `SILO_API_TOKEN` on this "deployment") so these route tests render
        // the app immediately, unaffected by the auth gate added in plan 030.
        if (url.includes('/api/auth/check')) {
          return Promise.resolve(jsonResponse({ authRequired: false }));
        }
        if (url === '/api/tags') return Promise.resolve(jsonResponse({ tags: [] }));
        if (url.includes('/api/links') || url.includes('/api/trash')) {
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
    // Both the sidebar and list header show the server total.
    await waitFor(() => expect(screen.getAllByText('128')).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Nothing kept yet.')).toBeDefined());
    expect(screen.getByRole('heading', { name: 'Library' })).toBeDefined();
    const libraryLink = screen.getByRole('link', { name: /library/i });
    expect(libraryLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders the Trash view + active nav item at /trash', async () => {
    renderApp(['/trash']);
    await waitFor(() => expect(screen.getByText('Trash is empty')).toBeDefined());
    fireEvent.click(
      screen.getByRole('heading', { name: 'Trash' }).querySelector('button') as HTMLButtonElement,
    );
    expect(screen.getByRole('menuitem', { name: /Library/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /Trash/ })).toBeDefined();
  });

  it('renders the tag-scoped Library view (title + empty state) at /tags/:name', async () => {
    renderApp(['/tags/mcp']);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '# mcp', level: 1 })).toBeDefined(),
    );
    await waitFor(() => expect(screen.getByText('No links tagged # mcp yet.')).toBeDefined());
  });

  it('renders the Settings view at /settings', async () => {
    renderApp(['/settings']);
    // v3's Settings is a MODAL — landing on /settings opens it over an empty
    // route backdrop (the modal IS the settings surface).
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined());
    // The modal's own content is present (a tab), not a stale "coming soon".
    expect(screen.getByRole('tab', { name: /preferences/i })).toBeDefined();
  });

  it.each([
    ['/settings?tab=prefs', 'Preferences'],
    ['/settings/prefs', 'Preferences'],
    ['/settings/import-export', 'Import & export'],
    ['/settings/unknown', 'Plugins'],
    ['/settings/preferences/legacy', 'Preferences'],
  ])('resolves the Settings deep link %s', async (route, selectedTab) => {
    renderApp([route]);
    await screen.findByRole('dialog', { name: 'Settings' });
    expect(screen.getByRole('tab', { name: selectedTab }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('closes the Settings modal when navigating away from /settings (no floating modal over the new route)', async () => {
    renderApp(['/settings']);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined());

    // Click the Library nav item — leaving /settings unmounts SettingsView,
    // whose cleanup closes the modal.
    fireEvent.click(screen.getByRole('link', { name: /silo home/i }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull());
  });

  it('renders a calm not-found view for an unknown path', async () => {
    renderApp(['/nope']);
    await waitFor(() => expect(screen.getByText(/Not found/i)).toBeDefined());
  });
});
