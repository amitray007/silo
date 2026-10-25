/// <reference types="node" />
import { createServer } from 'node:http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrl } from '../../api/client';
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
    async (_url: string, init?: RequestInit) =>
      new Response(
        init?.method === 'HEAD'
          ? null
          : JSON.stringify(
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
  setApiBaseUrl('');
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
  it('waits for the hint, then loads the live site without offering an unapproved silo view', async () => {
    const { container, fetch } = show();
    expect(container.querySelector('iframe')).toBeNull();
    await waitFor(() => expect(container.querySelector('iframe')?.src).toBe(link.url));
    expect(fetch).toHaveBeenCalledWith(
      '/api/links/link-id/frame',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/Live site ·/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show silo view' })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /Open in new tab/ }).getAttribute('href')).toBe(
      link.url,
    );
  });
  it('uses silo view for blocked framing and allows an explicit live-site attempt', async () => {
    const { container, fetch } = show('view');
    await waitFor(() => expect(screen.getByTitle('Silo view')).toBeDefined());
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-popups allow-popups-to-escape-sandbox',
    );
    expect(container.querySelector('iframe')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(fetch).toHaveBeenCalledWith(
      '/api/links/link-id/view',
      expect.objectContaining({
        method: 'HEAD',
        credentials: 'include',
        signal: expect.any(AbortSignal),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load live site' }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(link.url);
    expect(container.querySelector('iframe')?.hasAttribute('sandbox')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show silo view' }));
    await screen.findByTitle('Silo view');
  });
  it.each(['none', 'error'] as const)('uses a card for %s with an escape link', async (mode) => {
    const { container } = show(mode);
    await waitFor(() => expect(screen.queryByText('Loading Original…')).toBeNull());
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Article' })).toBeDefined();
    expect(screen.getByText(/Link card ·/)).toBeDefined();
    expect(screen.getByRole('link', { name: /Open in new tab/ })).toBeDefined();
  });
  it('shows the card when /frame succeeds but the real /view HTTP request returns 503', async () => {
    const requests: string[] = [];
    let failView: (() => void) | undefined;
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      if (request.url?.endsWith('/frame')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ mode: 'view', contentType: 'text/html' }));
      } else {
        failView = () => {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'service_unavailable', message: 'Unavailable' }));
        };
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No bound address');
    setApiBaseUrl(`http://127.0.0.1:${address.port}`);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <Original link={link} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => expect(requests).toContain('HEAD /api/links/link-id/view'));
      expect(view.container.querySelector('iframe')).toBeNull();
      failView?.();
      failView = undefined;
      await waitFor(() => expect(screen.queryByText('Loading Original…')).toBeNull());
      expect(requests).toContain('GET /api/links/link-id/frame');
      expect(view.container.querySelector('iframe')).toBeNull();
      expect(screen.getByText(/Link card ·/)).toBeDefined();
    } finally {
      failView?.();
      view.unmount();
      client.clear();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('keeps a frameable PDF in direct mode without offering silo view', async () => {
    const { container } = show('direct', 'https://arxiv.org/pdf/1706.03762', 'application/pdf');
    await screen.findByTitle('Original page');
    expect(screen.queryByRole('button', { name: 'Show silo view' })).toBeNull();
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://arxiv.org/pdf/1706.03762',
    );
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
