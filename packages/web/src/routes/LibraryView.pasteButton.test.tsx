import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/counts') {
          return Promise.resolve(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 }));
        }
        if (url === '/api/links') return Promise.resolve(jsonResponse({ links: [] }));
        if (url === '/api/links' /* POST capture */) {
          return Promise.resolve(jsonResponse({ link: {} }, 201));
        }
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
    expect((await screen.findByRole('status')).textContent).toBe('Saved');
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
