import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { FeedJson } from '../api/types';
import { SidebarFeeds } from './SidebarFeeds';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('delays decorative feed rows and announces loading until the request settles', async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const { container } = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SidebarFeeds onNavigate={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const region = screen.getByRole('region', { name: 'Feed subscriptions' });
  expect(region.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('status').textContent).toBe('Loading feeds');
  expect(screen.getByRole('status').className).toBe('silo-sr-only');
  const add = screen.getByRole('button', { name: 'Add feed' });
  const list = container.querySelector('.silo-sidebar-skeleton-list');
  expect(list?.getAttribute('data-visible')).toBe('false');
  expect(list?.getAttribute('aria-hidden')).toBe('true');
  act(() => vi.advanceTimersByTime(150));
  expect(list?.getAttribute('data-visible')).toBe('true');
  expect(region.querySelectorAll('.silo-sidebar-row-skeleton')).toHaveLength(3);
  await act(async () => {
    resolve(new Response(JSON.stringify({ feeds: [] })));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(region.getAttribute('aria-busy')).toBe('false');
  expect(screen.queryByRole('status')).toBeNull();
  expect(container.querySelector('.silo-sidebar-skeleton-list')).toBeNull();
  expect(screen.getByRole('button', { name: 'Add feed' })).toBe(add);
});
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
  expect(screen.getByText('No feeds match "').closest('p')?.textContent).toBe(
    'No feeds match "missing"',
  );
  const toggle = screen.getByRole('button', { name: 'Toggle feeds' });
  toggle.focus();
  fireEvent.click(toggle);
  expect(screen.queryByRole('textbox', { name: 'Find feed' })).toBeNull();
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(toggle);
  expect(screen.getByRole('textbox', { name: 'Find feed' })).toHaveProperty('value', 'missing');
  fireEvent.click(screen.getByRole('button', { name: 'Find a feed' }));
  expect(screen.queryByPlaceholderText('Find feed')).toBeNull();
  expect(screen.getByRole('link', { name: /Publisher 0/ })).toBeDefined();
  expect(screen.queryByText('No feeds match "')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Find a feed' }));
  expect(screen.getByPlaceholderText('Find feed')).toHaveProperty('value', '');
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find feed' }));
});

it('clears by button or Escape, then closes on empty Escape and restores toggle focus', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ feeds: [] })))),
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
  const find = screen.getByRole('button', { name: 'Find a feed' });
  fireEvent.click(find);
  const input = screen.getByRole('textbox', { name: 'Find feed' });
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  fireEvent.change(input, { target: { value: 'News' } });
  await screen.findByText('No feeds match "');
  const clear = screen.getByRole('button', { name: 'Clear' });
  clear.focus();
  fireEvent.click(clear);
  expect(input).toHaveProperty('value', '');
  expect(document.activeElement).toBe(input);
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  expect(screen.queryByText('No feeds match "')).toBeNull();
  fireEvent.change(input, { target: { value: 'News' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveProperty('value', '');
  expect(document.activeElement).toBe(input);
  expect(find.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Find feed' })).toBeNull();
  expect(document.activeElement).toBe(find);
  expect(find.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(find);
  const emptyInput = screen.getByRole('textbox', { name: 'Find feed' });
  expect(document.activeElement).toBe(emptyInput);
  fireEvent.keyDown(emptyInput, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Find feed' })).toBeNull();
  expect(document.activeElement).toBe(find);
});
