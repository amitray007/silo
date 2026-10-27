/// <reference types="node" />
import { createServer } from 'node:http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrl } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { makeLink } from '../../test/fixtures';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Original } from './Original';
import { useOriginal } from './useOriginal';

function Standalone({ link, showReader = () => {} }: { link: LinkJson; showReader?: () => void }) {
  const state = useOriginal(link, true);
  return (
    <>
      <button type="button" onClick={() => state.refresh.mutate(link.id)}>
        Reload page
      </button>
      <button type="button" onClick={state.toggleDarkPage}>
        Toggle page theme
      </button>
      <Original link={link} state={state} showReader={showReader} />
    </>
  );
}

const link = makeLink({ id: 'link-id', url: 'https://publisher.test/article', title: 'Article' });
function show(
  mode: 'direct' | 'view' | 'none' | 'error' = 'direct',
  url = link.url,
  contentType?: string,
  reason?: string,
  darkTheme?: boolean,
) {
  const fetch = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        init?.method === 'HEAD'
          ? null
          : JSON.stringify(
              mode === 'error'
                ? { error: 'service_unavailable', message: 'Unavailable' }
                : { mode, contentType, reason, darkTheme },
            ),
        { status: mode === 'error' ? 503 : 200 },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const showReader = vi.fn();
  const rendered = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <Standalone link={{ ...link, url }} showReader={showReader} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, fetch, client, showReader };
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
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
    // Scripts plus same-origin would let the copy lift its own sandbox.
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-popups allow-popups-to-escape-sandbox',
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
    await waitFor(() => expect(container.querySelector('.silo-original-card')).not.toBeNull());
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
      expect(view.container.querySelector('iframe')?.getAttribute('title')).toBe('Silo view');
      expect(
        view.container.querySelector('.silo-frame-loading')?.getAttribute('data-loading'),
      ).toBe('true');
      failView?.();
      failView = undefined;
      await waitFor(() =>
        expect(view.container.querySelector('.silo-original-card')).not.toBeNull(),
      );
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
    await screen.findByTitle('Live page');
    expect(screen.queryByRole('button', { name: 'Show silo view' })).toBeNull();
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://arxiv.org/pdf/1706.03762',
    );
  });

  it('refreshes via /frame?fresh=1 and remounts the iframe after it resolves', async () => {
    const { container, fetch } = show();
    await screen.findByTitle('Live page');
    const previous = container.querySelector('iframe');
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
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
  it('follows a Reload result that now requires silo view', async () => {
    const { container, fetch } = show('direct', link.url, 'text/html');
    await screen.findByTitle('Live page');
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ mode: 'view', contentType: 'text/html' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    await screen.findByTitle('Silo view');
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain(
      '/api/links/link-id/view',
    );
  });
});

describe('Original same-origin and reload binding', () => {
  it('never frames a same-origin page live, even when the hint says direct', async () => {
    const { container } = show('direct', `${window.location.origin}/inside`);
    const frame = await screen.findByTitle('Silo view');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(screen.queryByTitle('Live page')).toBeNull();
    expect(container.querySelector('.silo-original')?.getAttribute('data-mode')).toBe('view');
  });
  it('writes a finished Reload to the link it started on, and leaves the new link alone', async () => {
    let finish: (() => void) | undefined;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('fresh=1'))
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return new Response(init?.method === 'HEAD' ? null : JSON.stringify({ mode: 'direct' }));
    });
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (current: LinkJson) => (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <Standalone link={current} />
        </ThemeProvider>
      </QueryClientProvider>
    );
    const first = makeLink({ id: 'link-a', url: 'https://publisher.test/a' });
    const second = makeLink({ id: 'link-b', url: 'https://publisher.test/b' });
    const view = render(tree(first));
    await screen.findByTitle('Live page');
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    await waitFor(() => expect(finish).toBeDefined());
    view.rerender(tree(second));
    const frame = await screen.findByTitle('Live page');
    await act(async () => {
      finish?.();
    });
    await waitFor(() => expect(client.getQueryData(queryKeys.frame('link-a'))).toBeDefined());
    expect(screen.getByTitle('Live page')).toBe(frame);
  });
});

describe('Live resilience', () => {
  it.each(['direct', 'view'] as const)(
    'keeps the same skeleton through %s frame loading',
    async (mode) => {
      const { container } = show(mode);
      const skeleton = screen.getByLabelText('Loading page...');
      const frame = await screen.findByTitle(mode === 'view' ? 'Silo view' : 'Live page');
      expect(screen.getByLabelText('Loading page...')).toBe(skeleton);
      expect(container.querySelectorAll('.silo-page-loading')).toHaveLength(1);
      fireEvent.load(frame);
      await waitFor(() =>
        expect(container.querySelector('.silo-frame-loading')?.getAttribute('data-loading')).toBe(
          'false',
        ),
      );
      expect(screen.getByLabelText('Loading page...')).toBe(skeleton);
      expect(skeleton.closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true');
    },
  );
  it('sandboxes direct pages without allowing top-level navigation', async () => {
    show('direct');
    const frame = await screen.findByTitle('Live page');
    expect(frame.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation',
    );
  });
  it.each([
    ['needs-script', 'This page needs its own scripts to display.'],
    ['fetch-error', 'Silo could not load this page.'],
    ['unsupported-content', 'This content cannot be displayed here.'],
  ])('shows the reason and both escape actions for %s', async (reason, message) => {
    const { showReader } = show('none', link.url, 'text/html', reason);
    await screen.findByText(message);
    fireEvent.click(screen.getByRole('button', { name: 'Show Reader' }));
    expect(showReader).toHaveBeenCalledTimes(1);
    const action = screen.getByRole('link', { name: 'Open in new tab' });
    expect(action.getAttribute('href')).toBe(link.url);
    expect(action.getAttribute('target')).toBe('_blank');
    expect(action.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('Live page theme', () => {
  it.each([
    ['direct', false, 'invert(0.9) hue-rotate(180deg)'],
    ['direct', true, ''],
    ['direct', undefined, ''],
    ['view', false, ''],
    ['view', true, ''],
  ] as const)(
    'styles %s with native dark %s and toggles light without reloading',
    async (mode, darkTheme, filter) => {
      localStorage.setItem('silo-theme', 'dark');
      const { fetch } = show(mode, link.url, 'text/html', undefined, darkTheme);
      const frame = (await screen.findByTitle(
        mode === 'direct' ? 'Live page' : 'Silo view',
      )) as HTMLIFrameElement;
      expect(frame.style.filter).toBe(filter);
      expect(frame.style.backgroundColor).toBe(filter ? 'white' : '');
      expect(frame.style.colorScheme).toBe('');
      const requests = fetch.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Toggle page theme' }));
      expect(frame.style.colorScheme).toBe('light');
      expect(frame.style.filter).toBe('');
      expect(frame.style.backgroundColor).toBe('');
      expect(screen.getByTitle(frame.title)).toBe(frame);
      expect(fetch).toHaveBeenCalledTimes(requests);
      expect(localStorage.getItem('silo.lightPages')).toBe('["publisher.test"]');
      fireEvent.click(screen.getByRole('button', { name: 'Toggle page theme' }));
      expect(frame.style.colorScheme).toBe('');
      expect(frame.style.filter).toBe(filter);
    },
  );

  it('removes all overrides when silo changes to light and restores them on dark', async () => {
    localStorage.setItem('silo-theme', 'dark');
    show('direct', link.url, 'text/html', undefined, false);
    const frame = (await screen.findByTitle('Live page')) as HTMLIFrameElement;
    expect(frame.style.filter).toContain('invert');
    await act(async () => {
      document.documentElement.dataset.theme = 'light';
    });
    expect(frame.style.filter).toBe('');
    expect(frame.style.colorScheme).toBe('');
    await act(async () => {
      document.documentElement.dataset.theme = 'dark';
    });
    expect(frame.style.filter).toContain('invert');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle page theme' }));
    await act(async () => {
      document.documentElement.dataset.theme = 'light';
    });
    expect(frame.style.colorScheme).toBe('');
    await act(async () => {
      document.documentElement.dataset.theme = 'dark';
    });
    expect(frame.style.colorScheme).toBe('light');
  });

  it('leaves embedded players unchanged even when their hostname is opted out', () => {
    localStorage.setItem('silo-theme', 'dark');
    localStorage.setItem('silo.lightPages', '["www.youtube.com"]');
    const { container } = show('direct', 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
    const frame = container.querySelector('iframe');
    expect(frame?.style.colorScheme).toBe('');
    expect(frame?.style.filter).toBe('');
  });
});
