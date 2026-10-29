import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { LinkJson } from '../api/types';
import { makeLink } from '../test/fixtures';
import { ThemeProvider } from '../theme/ThemeProvider';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const feed = {
  id: 'feed',
  title: 'Publisher',
  siteUrl: 'https://example.com',
  feedUrl: 'https://example.com/rss',
  postCount: 3,
  inboxCount: 2,
  status: 'active',
  format: 'rss',
  lastError: null,
  createdAt: '2026-10-29T00:00:00Z',
};
function writePost(posts: LinkJson[], path: string) {
  const post = posts.find((post) => post.id === path.split('/')[5]);
  if (!post) return json({ error: 'not_found' }, 404);
  if (path.endsWith('/save')) {
    post.savedLinkId = 'saved';
    return json({ id: 'saved', outcome: 'created' }, 201);
  }
  post.archivedAt = path.endsWith('/unarchive') ? null : new Date().toISOString();
  return json({ id: post.id, archivedAt: post.archivedAt });
}
function mount() {
  const today = new Date();
  const recent = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2, 12);
  const posts: LinkJson[] = [
    makeLink({ id: 'a', feedId: 'feed', title: 'Today post', publishedAt: today.toISOString() }),
    makeLink({ id: 'b', feedId: 'feed', title: 'Recent post', publishedAt: recent.toISOString() }),
    makeLink({
      id: 'c',
      feedId: 'feed',
      title: 'Old post',
      publishedAt: '2020-01-01T12:00:00Z',
      archivedAt: today.toISOString(),
    }),
  ];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://silo.test');
    const path = url.pathname;
    const method = init?.method;

    if (method === 'POST' && path.startsWith('/api/feeds/feed/posts/')) {
      return writePost(posts, path);
    }
    const currentFeed = { ...feed, inboxCount: posts.filter((post) => !post.archivedAt).length };
    const reads: Record<string, () => Response> = {
      '/api/auth/check': () => json({ authRequired: false }),
      '/api/settings': () => json({ theme: 'light', plugins: {} }),
      '/api/counts': () => json({ live: posts.some((post) => post.savedLinkId) ? 1 : 0, trash: 0 }),
      '/api/links': () =>
        json({
          links: posts
            .filter((post) => post.savedLinkId)
            .map((post) => ({ ...post, id: 'saved', feedId: null })),
        }),
      '/api/links/saved': () => json({ link: makeLink({ id: 'saved', title: 'Home copy' }) }),
      '/api/tags': () => json({ tags: [] }),
      '/api/feeds': () => json({ feeds: [currentFeed] }),
      '/api/feeds/feed': () => json({ feed: currentFeed }),
      '/api/feeds/feed/posts': () =>
        json({
          links: posts
            .filter(
              (post) => Boolean(post.archivedAt) === (url.searchParams.get('tab') === 'archive'),
            )
            .map((post) => ({ ...post })),
        }),
    };
    const read = reads[path];
    if (read) return read();
    const post = posts.find((post) => path === `/api/links/${post.id}`);
    if (post) return json({ link: { ...post } });
    if (path.endsWith('/frame')) return json({ mode: 'direct' });
    return json({ error: 'not_found', message: 'Not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <ThemeProvider>
        <MemoryRouter initialEntries={['/feeds/feed']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { posts, fetchMock };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const list = () => within(screen.getByRole('region', { name: 'Feeds / Publisher links' }));
const reader = () => within(screen.getByRole('region', { name: 'Link reader' }));

it('groups publisher dates, moves rows between tabs and updates the sidebar Inbox count', async () => {
  mount();
  await screen.findByText('Today post');
  expect(list().getByText('Today')).toBeDefined();
  expect(list().getByText('This week')).toBeDefined();
  expect(list().queryByText('Earlier')).toBeNull();
  expect(list().queryByRole('button', { name: 'Move to trash' })).toBeNull();
  fireEvent.click(list().getAllByRole('button', { name: 'Archive' })[0] as HTMLElement);
  await waitFor(() => expect(list().queryByText('Today post')).toBeNull());
  const sidebarFeed = screen.getByRole('link', { name: /Publisher/ });
  await waitFor(() => expect(sidebarFeed.textContent).toContain('1'));
  fireEvent.click(screen.getByRole('tab', { name: 'Archive' }));
  await waitFor(() => expect(list().getByText('Today post')).toBeDefined());
  expect(list().getByText('Earlier')).toBeDefined();
  expect(list().queryByText('Recent post')).toBeNull();
  fireEvent.click(list().getAllByRole('button', { name: 'Unarchive' })[0] as HTMLElement);
  await waitFor(() => expect(list().queryByText('Today post')).toBeNull());
  await waitFor(() => expect(sidebarFeed.textContent).toContain('2'));
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Archive' }), { key: 'ArrowLeft' });
  await waitFor(() => expect(list().getByText('Today post')).toBeDefined());
});

it('steps within the current tab, archives with e and unarchives from the Reader toolbar', async () => {
  const { fetchMock } = mount();
  fireEvent.click(await screen.findByText('Today post'));
  await waitFor(() => expect(reader().getByRole('heading', { name: 'Today post' })).toBeDefined());
  fireEvent.keyDown(document, { key: 'ArrowDown' });
  await waitFor(() => expect(reader().getByRole('heading', { name: 'Recent post' })).toBeDefined());
  fireEvent.keyDown(document, { key: 'e' });
  await waitFor(() => expect(list().queryByText('Recent post')).toBeNull());
  await waitFor(() => expect(reader().getByRole('heading', { name: 'Today post' })).toBeDefined());
  fireEvent.click(screen.getByRole('tab', { name: 'Archive' }));
  await waitFor(() => expect(list().getByText('Recent post')).toBeDefined());
  expect(reader().queryByRole('heading')).toBeNull();
  fireEvent.click(list().getByText('Recent post'));
  fireEvent.click(await reader().findByRole('button', { name: 'Unarchive' }));
  await waitFor(() => expect(list().queryByText('Recent post')).toBeNull());
  await waitFor(() => expect(reader().getByRole('heading', { name: 'Old post' })).toBeDefined());
  expect(reader().queryByRole('button', { name: 'Move to trash' })).toBeNull();
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) => String(url).includes('/api/links/') && init?.method === 'POST',
    ),
  ).toBe(false);
});

it('keeps the post and count when archive fails and shows the API error', async () => {
  const { fetchMock } = mount();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'POST'
      ? Promise.resolve(
          json({ error: 'internal_error', message: 'Archive failed. Try again.' }, 503),
        )
      : fetchMock(input, init),
  );
  await screen.findByText('Today post');
  fireEvent.click(list().getAllByRole('button', { name: 'Archive' })[0] as HTMLElement);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Archive failed. Try again.',
  );
  expect(list().getByText('Today post')).toBeDefined();
  expect(screen.getByRole('link', { name: /Publisher/ }).textContent).toContain('2');
});

it('saves from a row, fills bookmarks in the row and Reader, updates Home and opens its copy', async () => {
  const { fetchMock } = mount();
  await screen.findByText('Today post');
  fireEvent.click(list().getAllByRole('button', { name: 'Save to Home' })[0] as HTMLElement);
  const saved = await list().findByRole('link', { name: 'Open saved' });
  expect(saved.getAttribute('href')).toBe('/?link=saved');
  expect(list().getByTitle('Saved to Home')).toBeDefined();
  fireEvent.click(list().getByText('Today post'));
  expect(await reader().findByRole('link', { name: 'Open saved' })).toBeDefined();
  expect(reader().queryByRole('button', { name: 'Save to Home' })).toBeNull();
  fireEvent.click(reader().getByRole('link', { name: 'Open saved' }));
  await waitFor(() => expect(reader().getByRole('heading', { name: 'Home copy' })).toBeDefined());
  expect(screen.getByRole('link', { name: /Library/ }).textContent).toContain('1');
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/save') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
});
it('saves from the Reader and reports save failures without filling the bookmark', async () => {
  const { fetchMock } = mount();
  fireEvent.click(await screen.findByText('Today post'));
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/save')
      ? Promise.resolve(json({ error: 'internal_error', message: 'Save failed. Try again.' }, 503))
      : fetchMock(input, init),
  );
  fireEvent.click(await reader().findByRole('button', { name: 'Save to Home' }));
  expect(await reader().findByText('Save failed. Try again.')).toBeDefined();
  expect(reader().queryByRole('link', { name: 'Open saved' })).toBeNull();
  vi.stubGlobal('fetch', fetchMock);
  fireEvent.click(reader().getByRole('button', { name: 'Save to Home' }));
  expect(await reader().findByRole('link', { name: 'Open saved' })).toBeDefined();
});
