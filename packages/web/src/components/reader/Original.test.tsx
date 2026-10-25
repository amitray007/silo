import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../../test/fixtures';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Original } from './Original';

const link = makeLink({ id: 'link-id', url: 'https://publisher.test/article', title: 'Article' });
function show(
  mode: 'direct' | 'view' | 'none' | 'error' = 'direct',
  url = link.url,
  contentType?: string,
) {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          mode === 'error'
            ? { error: 'service_unavailable', message: 'Unavailable' }
            : { mode, contentType },
        ),
        { status: mode === 'error' ? 503 : 200 },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Original link={{ ...link, url }} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, fetch };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Original mode order', () => {
  it('prefers a provider player and makes no page-view request', () => {
    const { container, fetch } = show('view', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
    expect(container.querySelector('.silo-original')?.getAttribute('data-mode')).toBe('player');
    expect(container.querySelector('iframe')?.src).toContain(
      'youtube-nocookie.com/embed/jNQXAC9IVRw',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Open in new tab/ })).toBeDefined();
  });
  it('waits for the hint, then loads the live site and can switch both ways', async () => {
    const { container, fetch } = show();
    expect(container.querySelector('iframe')).toBeNull();
    await waitFor(() => expect(container.querySelector('iframe')?.src).toBe(link.url));
    expect(fetch).toHaveBeenCalledWith(
      '/api/links/link-id/frame',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/Live site ·/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Show silo view' }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('/api/links/link-id/view');
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-popups allow-popups-to-escape-sandbox',
    );
    expect(screen.getByText(/Silo view ·/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Load live site' }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(link.url);
    expect(screen.getByRole('link', { name: /Open in new tab/ }).getAttribute('href')).toBe(
      link.url,
    );
  });
  it('uses silo view for blocked framing and allows an explicit live-site attempt', async () => {
    const { container } = show('view');
    await waitFor(() => expect(screen.getByTitle('Silo view')).toBeDefined());
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-popups allow-popups-to-escape-sandbox',
    );
    expect(container.querySelector('iframe')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.click(screen.getByRole('button', { name: 'Load live site' }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(link.url);
    expect(container.querySelector('iframe')?.hasAttribute('sandbox')).toBe(false);
  });
  it.each(['none', 'error'] as const)('uses a card for %s with an escape link', async (mode) => {
    const { container } = show(mode);
    await waitFor(() => expect(screen.queryByText('Loading Original…')).toBeNull());
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Article' })).toBeDefined();
    expect(screen.getByText(/Link card ·/)).toBeDefined();
    expect(screen.getByRole('link', { name: /Open in new tab/ })).toBeDefined();
  });
  it('falls back to the card on an iframe error', async () => {
    const { container } = show('view');
    const iframe = await screen.findByTitle('Silo view');
    fireEvent.error(iframe);
    await waitFor(() => expect(container.querySelector('iframe')).toBeNull());
    expect(screen.getByText(/Link card ·/)).toBeDefined();
  });
  it('shows a card when a non-HTML page cannot provide the requested silo view', async () => {
    const { container } = show('direct', 'https://arxiv.org/pdf/1706.03762', 'application/pdf');
    await screen.findByTitle('Original page');
    fireEvent.click(screen.getByRole('button', { name: 'Show silo view' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText(/Link card ·/)).toBeDefined();
  });

  it('cancels the frame-hint request when Original closes', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <Original link={link} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
