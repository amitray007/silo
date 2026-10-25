/// <reference types="node" />
import { createServer } from 'node:http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrl } from '../../api/client';
import type { LinkJson } from '../../api/types';
import { makeLink } from '../../test/fixtures';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Original } from './Original';
import { useOriginal } from './useOriginal';

function Standalone({ link }: { link: LinkJson }) {
  const state = useOriginal(link, true);
  return (
    <>
      <button type="button" onClick={() => state.refresh.mutate()}>
        Refresh Original
      </button>
      <Original link={link} state={state} />
    </>
  );
}

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
        <Standalone link={{ ...link, url }} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, fetch, client };
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
    expect(container.querySelector('.silo-original-bar')).toBeNull();
  });
  it('waits for the hint, then loads the live site without offering an unapproved silo view', async () => {
    const { container, fetch } = show();
    expect(container.querySelector('iframe')).toBeNull();
    await waitFor(() => expect(container.querySelector('iframe')?.src).toBe(link.url));
    expect(fetch).toHaveBeenCalledWith(
      '/api/links/link-id/frame',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
    expect(container.querySelector('.silo-original')?.getAttribute('data-mode')).toBe('direct');
    expect(screen.queryByRole('button', { name: 'Show silo view' })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses silo view for blocked framing', async () => {
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
  });
  it.each(['none', 'error'] as const)('uses a card for %s with an escape link', async (mode) => {
    const { container } = show(mode);
    await waitFor(() => expect(screen.queryByLabelText('Preparing page...')).toBeNull());
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Article' })).toBeDefined();
    expect(container.querySelector('.silo-original')?.getAttribute('data-mode')).toBe('card');
    expect(container.querySelector('.silo-original-bar')).toBeNull();
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
          <Standalone link={link} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => expect(requests).toContain('HEAD /api/links/link-id/view'));
      expect(view.container.querySelector('iframe')).toBeNull();
      failView?.();
      failView = undefined;
      await waitFor(() => expect(screen.queryByLabelText('Preparing page...')).toBeNull());
      expect(requests).toContain('GET /api/links/link-id/frame');
      expect(view.container.querySelector('iframe')).toBeNull();
      expect(view.container.querySelector('.silo-original')?.getAttribute('data-mode')).toBe(
        'card',
      );
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

  it('refreshes via /frame?fresh=1 and remounts the iframe after it resolves', async () => {
    const { container, fetch } = show();
    await screen.findByTitle('Original page');
    const previous = container.querySelector('iframe');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Original' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/links/link-id/frame?fresh=1', expect.anything()),
    );
    await waitFor(() => expect(container.querySelector('iframe')).not.toBe(previous));
    expect(container.querySelector('iframe')?.src).toBe(link.url);
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
          <Standalone link={link} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it('follows a Refresh result that now requires silo view', async () => {
    const { container, fetch } = show('direct', link.url, 'text/html');
    await screen.findByTitle('Original page');
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ mode: 'view', contentType: 'text/html' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Original' }));
    await screen.findByTitle('Silo view');
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain(
      '/api/links/link-id/view',
    );
  });
});
