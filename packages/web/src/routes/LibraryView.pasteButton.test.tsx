import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverPreviewProvider } from '../components/HoverPreviewContext';
import { RowMenuProvider } from '../components/RowMenuContext';
import { LibraryView } from './LibraryView';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mirrors `LibraryView.test.tsx`'s own render wrapper — a real `QueryClient` with `fetch` mocked. */
function renderLibraryView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <HoverPreviewProvider>
            <LibraryView />
          </HoverPreviewProvider>
        </RowMenuProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/**
 * The Library header's paste-capture button (`PasteCaptureButton` in
 * `LibraryView.tsx`) — the mobile/desktop tap-to-paste affordance that reads
 * `navigator.clipboard.readText()` on click. Each test stubs
 * `navigator.clipboard` fresh (jsdom doesn't implement the Clipboard API at
 * all) to drive one outcome at a time, matching the method doc's frozen
 * state → message table.
 */
describe('LibraryView paste-capture button', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/links' && init?.method === 'POST') {
          return Promise.resolve(jsonResponse({ link: {} }, 201));
        }
        if (url === '/api/links') return Promise.resolve(jsonResponse({ links: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubClipboard(impl: { readText?: () => Promise<string> } | undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      value: impl,
      configurable: true,
    });
  }

  it('captures a URL from the clipboard and shows a success toast', async () => {
    stubClipboard({ readText: () => Promise.resolve('https://example.com/post') });
    renderLibraryView();

    const button = await screen.findByRole('button', { name: 'Add link' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('https://example.com/post'),
        }),
      ),
    );
    expect((await within(screen.getByRole('dialog')).findByRole('status')).textContent).toBe(
      'Saved',
    );
  });

  it('saves a typed URL and closes with Escape, returning focus to Add', async () => {
    renderLibraryView();
    const trigger = screen.getByRole('button', { name: 'Add link' });
    fireEvent.click(trigger);
    const input = screen.getByRole('textbox', { name: 'Link URL' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'https://example.com/typed' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('https://example.com/typed'),
        }),
      ),
    );
    await screen.findByRole('status');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('saves through the inline icon and disables it for empty input', async () => {
    renderLibraryView();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const input = screen.getByRole('textbox', { name: 'Link URL' });
    const save = screen.getByRole('button', { name: 'Save link' }) as HTMLButtonElement;
    expect(input.getAttribute('placeholder')).toBe('Paste or type a link');
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' https://example.com/icon ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect((await within(screen.getByRole('dialog')).findByRole('status')).textContent).toBe(
      'Saved',
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/links',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/icon', source: 'web' }),
      }),
    );
    expect((input as HTMLInputElement).value).toBe('');
    expect(save.disabled).toBe(true);
  });

  it('blocks repeated submission and clipboard capture while saving', async () => {
    renderLibraryView();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    const input = screen.getByRole('textbox', { name: 'Link URL' });
    fireEvent.change(input, { target: { value: 'https://example.com/pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save link' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(
      (screen.getByRole('button', { name: 'Paste from clipboard' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      1,
    );
  });

  it('validates typed text without submitting a capture request', async () => {
    renderLibraryView();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: 'some notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(screen.getByRole('alert').textContent).toBe("That doesn't look like a link");
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/links',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps the URL and shows an alert when saving fails', async () => {
    renderLibraryView();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: 'failed' }, 500)),
    );
    const input = screen.getByRole('textbox', { name: 'Link URL' });
    fireEvent.change(input, { target: { value: 'https://example.com/error' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't save that link. Try again.",
    );
    expect((input as HTMLInputElement).value).toBe('https://example.com/error');
  });

  it('links only to the three available clients in new tabs', () => {
    renderLibraryView();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const dialog = screen.getByRole('dialog', { name: 'Paste to save' });
    expect(dialog.textContent).toContain('Apps & extensions');
    expect(dialog.querySelectorAll('a')).toHaveLength(3);
    for (const [name, href] of [
      ['Chrome extension', 'https://github.com/amitray007/silo/releases?q=chrome-v&expanded=true'],
      ['Raycast', 'https://github.com/amitray007/silo/releases?q=raycast-v&expanded=true'],
      ['Command line', 'https://github.com/amitray007/silo#clients'],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('closes on an outside click', () => {
    renderLibraryView();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows "Clipboard is empty" for blank clipboard content, without calling capture', async () => {
    stubClipboard({ readText: () => Promise.resolve('   ') });
    renderLibraryView();

    const button = await screen.findByRole('button', { name: 'Add link' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Clipboard is empty');
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/links',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows "That doesn\'t look like a link" for non-URL text, without calling capture', async () => {
    stubClipboard({ readText: () => Promise.resolve('just some notes') });
    renderLibraryView();

    const button = await screen.findByRole('button', { name: 'Add link' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

    expect((await screen.findByRole('alert')).textContent).toBe("That doesn't look like a link");
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/links',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows "Clipboard access blocked" when readText is unavailable (Firefox-shaped)', async () => {
    stubClipboard(undefined);
    renderLibraryView();

    const button = await screen.findByRole('button', { name: 'Add link' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Clipboard access blocked');
  });

  it('shows "Clipboard access blocked" when readText rejects (denied permission), never throwing', async () => {
    stubClipboard({ readText: () => Promise.reject(new Error('Permission denied')) });
    renderLibraryView();

    const button = await screen.findByRole('button', { name: 'Add link' });
    // A rejected readText() must be swallowed by the component's own
    // try/catch — fireEvent.click must not throw/reject up through the test.
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Clipboard access blocked');
  });
});
