import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { RowMenu } from './RowMenu';
import { RowMenuProvider, useRowMenu } from './RowMenuContext';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A tiny consumer so tests can observe `useRowMenu()`'s state (whether the menu/edit-modal opened) without pulling in the whole `LinkRow`/`AppFrame` stack. */
function MenuOpenProbe() {
  const { openMenuId, editingLink } = useRowMenu();
  return (
    <div>
      <span data-testid="open-menu-id">{openMenuId ?? 'none'}</span>
      <span data-testid="editing-link-id">{editingLink?.id ?? 'none'}</span>
    </div>
  );
}

function renderMenu(overrides: Parameters<typeof makeLink>[0] = {}) {
  const link = makeLink({ id: 'row-1', url: 'https://example.com/x', tags: ['mcp'], ...overrides });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <MenuOpenProbe />
        <RowMenu link={link} />
      </RowMenuProvider>
    </QueryClientProvider>,
  );
  return { ...utils, link, queryClient };
}

describe('RowMenu', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ tags: [{ name: 'mcp', count: 2 }] })),
    );
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders every v3 menu item: tags row, open-in-new-tab, copy link, edit, move to trash', () => {
    renderMenu();
    expect(screen.getByText('tags')).toBeDefined();
    expect(screen.getByText('open in new tab')).toBeDefined();
    expect(screen.getByText('copy link')).toBeDefined();
    expect(screen.getByText('edit')).toBeDefined();
    expect(screen.getByText('move to trash')).toBeDefined();
  });

  it('shows the assigned tag count next to "tags"', () => {
    renderMenu({ tags: ['mcp', 'ai'] });
    // The count sits in its own span right after "tags".
    expect(screen.getByText('2')).toBeDefined();
  });

  it('"open in new tab" is a real anchor to the link url', () => {
    renderMenu({ url: 'https://example.com/specific-path' });
    const anchor = screen.getByText('open in new tab').closest('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://example.com/specific-path');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });

  it('copy link writes the url to the clipboard and shows a "copied" state that resets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { link } = renderMenu({ url: 'https://example.com/copy-me' });

    fireEvent.click(screen.getByText('copy link'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.url);
    expect(screen.getByText('copied')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(screen.getByText('copy link')).toBeDefined());
    vi.useRealTimers();
  });

  it('clicking "edit" opens the edit modal for this link (via context) and does not itself close via closeMenu call errors', () => {
    renderMenu();
    fireEvent.click(screen.getByText('edit'));
    expect(screen.getByTestId('editing-link-id').textContent).toBe('row-1');
  });

  it('clicking "move to trash" calls the trash mutation (POSTs /api/links/:id/trash)', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('move to trash'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/row-1/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('opening the tags fly-out (hover or click) shows the find-tag input and toggle list', () => {
    renderMenu({ tags: ['mcp'] });
    fireEvent.click(screen.getByText('tags'));
    expect(screen.getByPlaceholderText('find tag')).toBeDefined();
    // 'mcp' appears once in the trigger row's count area's sibling list item too.
    expect(screen.getAllByText('mcp').length).toBeGreaterThan(0);
  });

  it('toggling an assigned tag off calls the remove-tag mutation (DELETE)', async () => {
    renderMenu({ tags: ['mcp'] });
    fireEvent.click(screen.getByText('tags'));

    const tagOption = screen.getAllByText('mcp').find((el) => el.closest('button'));
    const button = tagOption?.closest('button');
    expect(button).toBeTruthy();
    fireEvent.click(button as HTMLButtonElement);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/row-1/tags/mcp',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('toggling an unassigned tag on calls the add-tag mutation (POST)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        tags: [
          { name: 'mcp', count: 2 },
          { name: 'design', count: 1 },
        ],
      }),
    );
    renderMenu({ tags: ['mcp'] });
    fireEvent.click(screen.getByText('tags'));

    await waitFor(() => expect(screen.getByText('design')).toBeDefined());
    fireEvent.click(screen.getByText('design').closest('button') as HTMLButtonElement);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/row-1/tags',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag: 'design' }) }),
      ),
    );
  });

  it('stops mousedown/click propagation so a click inside the popover never bubbles up (no row navigation)', () => {
    const outerHandler = vi.fn();
    const link = makeLink({ id: 'row-2', url: 'https://example.com' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only bubbling probe.
      // biome-ignore lint/a11y/noStaticElementInteractions: test-only bubbling probe.
      <div onClick={outerHandler}>
        <QueryClientProvider client={queryClient}>
          <RowMenuProvider>
            <RowMenu link={link} />
          </RowMenuProvider>
        </QueryClientProvider>
      </div>,
    );

    fireEvent.click(screen.getByText('copy link'));
    expect(outerHandler).not.toHaveBeenCalled();
  });
});
