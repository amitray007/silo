import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';

const feeds = vi.hoisted(() => {
  let resolve = () => {};
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, resolve, loaded: false };
});
vi.mock('./routes/FeedsView', async (original) => {
  feeds.loaded = true;
  await feeds.ready;
  return original();
});
const detail = vi.hoisted(() => {
  let resolve = () => {};
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, resolve };
});
vi.mock('./routes/FeedView', async () => {
  await detail.ready;
  return { FeedView: () => <p>Loaded feed detail</p> };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('defers the feed route and preserves the sidebar and pane frame during loading', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const path = String(input);
      const body =
        path === '/api/auth/check'
          ? { authRequired: false }
          : path === '/api/feeds'
            ? { feeds: [] }
            : path === '/api/tags'
              ? { tags: [] }
              : path.startsWith('/api/links')
                ? { links: [] }
                : { live: 0, trash: 0 };
      return new Response(JSON.stringify(body));
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Nothing saved yet', {}, { timeout: 5000 });
  expect(feeds.loaded).toBe(false);
  const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
  fireEvent.click(screen.getByRole('link', { name: 'Feeds' }));
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeDefined();
  expect(document.querySelector('.silo-three-pane .silo-listpane')).not.toBeNull();
  expect(document.querySelector('.silo-readerpane')).not.toBeNull();
  expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBe(sidebar);
  await act(async () => {
    feeds.resolve();
  });
  expect(await screen.findByText('No feeds yet', {}, { timeout: 5000 })).toBeDefined();
  expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBe(sidebar);
  view.unmount();
  client.clear();
});

it('preserves the feed detail frame with disabled Inbox and Archive tabs while suspended', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input) === '/api/auth/check'
              ? { authRequired: false }
              : String(input) === '/api/feeds'
                ? { feeds: [] }
                : String(input) === '/api/tags'
                  ? { tags: [] }
                  : { live: 0, trash: 0 },
          ),
        ),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/feeds/feed-id']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('status', { name: 'Loading…' });
  expect(screen.getByRole('tab', { name: 'Inbox' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('tab', { name: 'Archive' }).hasAttribute('disabled')).toBe(true);
  expect(document.querySelector('.silo-listpane')).not.toBeNull();
  const sidebar = screen.getByRole('navigation', { name: 'Sidebar' });
  await act(async () => detail.resolve());
  await screen.findByText('Loaded feed detail');
  expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBe(sidebar);
  view.unmount();
  client.clear();
});
