import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddFeedDialog } from './AddFeedDialog';
import { SidebarFeeds } from './SidebarFeeds';

function Location() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}
function mount(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {children}
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const feed = {
  id: 'feed-id',
  title: 'A publisher with a long title',
  siteUrl: 'https://example.com',
  feedUrl: 'https://example.com/rss',
  postCount: 12,
  inboxCount: 12,
  status: 'active',
  lastError: null,
  format: 'rss',
  createdAt: '2026-10-29T00:00:00Z',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('feed subscription UI', () => {
  it('defaults recents on, submits the URL, closes and navigates on success', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ feed, deduped: false }, 201));
    vi.stubGlobal('fetch', fetch);
    const close = vi.fn();
    const subscribed = vi.fn();
    mount(<AddFeedDialog onClose={close} onSubscribed={subscribed} />);
    const input = screen.getByLabelText('Website or feed URL');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((screen.getByLabelText('Sync recents') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(subscribed).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      url: 'https://example.com',
      syncRecents: true,
    });
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/feeds/feed-id'));
  });
  it('keeps lookup errors inline, allows recents off, and closes on Escape', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json({ error: 'feed_not_found', message: 'No feed found at this URL.' }, 422),
      );
    vi.stubGlobal('fetch', fetch);
    const close = vi.fn();
    mount(<AddFeedDialog onClose={close} onSubscribed={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Website or feed URL'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByLabelText('Sync recents'));
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No feed found at this URL.');
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body).syncRecents).toBe(false);
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('shows feed title, local favicon, live count, collapse and Add feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ feeds: [feed] })));
    mount(<SidebarFeeds onNavigate={vi.fn()} />);
    const link = await screen.findByRole('link', { name: /A publisher with a long title/ });
    expect(link.title).toBe(feed.title);
    expect(link.getAttribute('href')).toBe('/feeds/feed-id');
    expect(link.textContent).toContain('12');
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/api/favicon?domain=example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle feeds' }));
    expect(screen.queryByRole('link', { name: /A publisher/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle feeds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add feed' }));
    expect(screen.getByRole('dialog', { name: 'Add feed' })).toBeTruthy();
  });
});

it('keeps the focused submit control during lookup and focuses the URL after failure', async () => {
  let reject: ((value: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    reject = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending),
  );
  mount(<AddFeedDialog onClose={vi.fn()} onSubscribed={vi.fn()} />);
  const input = screen.getByLabelText('Website or feed URL') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'https://example.com' } });
  const submit = screen.getByRole('button', { name: 'Subscribe' }) as HTMLButtonElement;
  submit.focus();
  fireEvent.click(submit);
  await waitFor(() => expect(input.readOnly).toBe(true));
  expect(input.getAttribute('aria-busy')).toBe('true');
  expect(submit.disabled).toBe(false);
  expect(submit.getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(submit);
  fireEvent.click(submit);
  reject?.(json({ error: 'feed_not_found', message: 'No feed found.' }, 422));
  await screen.findByRole('alert');
  await waitFor(() => expect(document.activeElement).toBe(input));
});
