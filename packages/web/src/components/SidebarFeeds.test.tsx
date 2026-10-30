import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { FeedJson } from '../api/types';
import { SidebarFeeds } from './SidebarFeeds';

afterEach(() => vi.unstubAllGlobals());
it('filters the complete feed list before paging, focuses the input and clears on toggle', async () => {
  const feeds: FeedJson[] = Array.from({ length: 75 }, (_, i) => ({
    id: `feed-${i}`,
    title: i === 74 ? 'Owner title' : `Publisher ${i}`,
    feedUrl: `https://example.com/${i}.rss`,
    siteUrl: 'https://example.com',
    format: 'rss',
    status: 'active',
    lastError: null,
    lastPolledAt: null,
    createdAt: '2026-10-29T00:00:00Z',
    inboxCount: 0,
    postCount: 0,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ feeds })))),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SidebarFeeds onNavigate={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('link', { name: /Publisher 0/ });
  expect(screen.queryByRole('link', { name: /Owner title/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Find a feed' }));
  const input = screen.getByRole('textbox', { name: 'Find feed' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '  OWNER  ' } });
  expect(screen.getByRole('link', { name: /Owner title/ }).getAttribute('href')).toBe(
    '/feeds/feed-74',
  );
  expect(screen.queryByRole('link', { name: /Publisher 0/ })).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.change(input, { target: { value: 'missing' } });
  expect(screen.queryByRole('link', { name: /Owner title/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Find a feed' }));
  expect(screen.queryByPlaceholderText('Find feed')).toBeNull();
  expect(screen.getByRole('link', { name: /Publisher 0/ })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Find a feed' }));
  expect(screen.getByPlaceholderText('Find feed')).toHaveProperty('value', '');
});
