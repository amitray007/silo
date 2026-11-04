import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeProvider';
import { SettingsProvider } from './SettingsContext';
import { Sidebar } from './Sidebar';

const json = (body: unknown) => new Response(JSON.stringify(body));
const chat = (n: number, linkId: string | null = null) => ({
  id: `chat-${n}`,
  title: `Chat ${n}`,
  linkId,
  linkTitle: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});
const chats = [1, 2, 3, 4, 5, 6, 7].map((n) => chat(n, n === 2 ? 'article' : null));

function Where() {
  const location = useLocation();
  return (
    <output data-testid="where">
      {location.pathname}
      {location.search}
    </output>
  );
}

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
      if (url.startsWith('/api/librarian/chats')) return json({ chats, nextCursor: null });
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
              <Where />
            </SettingsProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

const where = () => screen.getByTestId('where').textContent;

it('shows a Chats section above Feeds with New chat and the 5 latest chats', async () => {
  renderSidebar({ ready: true });
  const recent = await screen.findByRole('region', { name: 'Recent chats' });
  await waitFor(() => expect(within(recent).getAllByRole('link')).toHaveLength(5));
  expect(within(recent).getByRole('link', { name: 'Chat 1' })).toBeDefined();
  expect(within(recent).queryByRole('link', { name: 'Chat 6' })).toBeNull();
  expect(screen.getByRole('link', { name: 'New chat' }).getAttribute('href')).toBe('/?chat=new');
  expect(screen.queryByRole('link', { name: 'All chats' })).toBeNull();
  const before = screen.getByRole('button', { name: 'Chats' });
  const feeds = screen.getByRole('link', { name: 'Feeds' });
  expect(before.compareDocumentPosition(feeds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('has no Librarian nav item, and no Chats section while the Librarian is off', async () => {
  renderSidebar({ ready: false });
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/ai', expect.anything()));
  await screen.findByRole('link', { name: /Library/ });
  expect(screen.queryByRole('link', { name: 'Librarian' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Chats' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'New chat' })).toBeNull();
});

it('has no Librarian nav item even when the Librarian is ready', async () => {
  renderSidebar({ ready: true });
  await screen.findByRole('link', { name: 'New chat' });
  expect(screen.queryByRole('link', { name: 'Librarian' })).toBeNull();
});

it('opens a chat beside the current list and marks it active', async () => {
  renderSidebar({ ready: true }, '/tags/ai?link=a');
  fireEvent.click(await screen.findByRole('link', { name: 'Chat 3' }));
  expect(where()).toBe('/tags/ai?chat=chat-3');
  expect(screen.getByRole('link', { name: 'Chat 3' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Chat 1' }).getAttribute('aria-current')).toBeNull();
});

it('starts a new chat beside the list', async () => {
  renderSidebar({ ready: true }, '/?chat=chat-2');
  fireEvent.click(await screen.findByRole('link', { name: 'New chat' }));
  expect(where()).toBe('/?chat=new');
});

it('opens the Librarian page for a chat picked in Trash', async () => {
  renderSidebar({ ready: true }, '/trash');
  fireEvent.click(await screen.findByRole('link', { name: 'Chat 1' }));
  expect(where()).toBe('/librarian?chat=chat-1');
});

it('collapses and expands the section', async () => {
  renderSidebar({ ready: true });
  const toggle = await screen.findByRole('button', { name: 'Chats' });
  fireEvent.click(toggle);
  expect(screen.queryByRole('link', { name: 'New chat' })).toBeNull();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(screen.getByRole('link', { name: 'New chat' })).toBeDefined();
});
