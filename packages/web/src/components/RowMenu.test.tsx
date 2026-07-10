import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { RowMenu } from './RowMenu';
import { RowMenuProvider, useRowMenu } from './RowMenuContext';
import { SelectionProvider } from './SelectionContext';

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
        <SelectionProvider>
          <MenuOpenProbe />
          <RowMenu link={link} />
        </SelectionProvider>
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
    expect(screen.getByText('Tags')).toBeDefined();
    expect(screen.getByText('Open in new tab')).toBeDefined();
    expect(screen.getByText('Copy link')).toBeDefined();
    expect(screen.getByText('Edit')).toBeDefined();
    expect(screen.getByText('Move to trash')).toBeDefined();
  });

  it('shows the assigned tag count next to "Tags"', () => {
    renderMenu({ tags: ['mcp', 'ai'] });
    // The count sits in its own span right after "Tags".
    expect(screen.getByText('2')).toBeDefined();
  });

  it('"open in new tab" is a real anchor to the link url', () => {
    renderMenu({ url: 'https://example.com/specific-path' });
    const anchor = screen.getByText('Open in new tab').closest('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('https://example.com/specific-path');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });

  it('copy link writes the url to the clipboard and shows a "copied" state that resets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { link } = renderMenu({ url: 'https://example.com/copy-me' });

    fireEvent.click(screen.getByText('Copy link'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.url);
    expect(screen.getByText('Copied')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(700);
    });
    await waitFor(() => expect(screen.getByText('Copy link')).toBeDefined());
    vi.useRealTimers();
  });

  it('clicking "edit" opens the edit modal for this link (via context) and does not itself close via closeMenu call errors', () => {
    renderMenu();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByTestId('editing-link-id').textContent).toBe('row-1');
  });

  it('clicking "move to trash" calls the trash mutation (POSTs /api/links/:id/trash)', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Move to trash'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/row-1/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('shows "Enrich" for a bare or partial link, and "Re-enrich" while already enriching', () => {
    renderMenu({ captureStatus: 'bare' });
    expect(screen.getByText('Enrich')).toBeDefined();

    renderMenu({ id: 'row-2', captureStatus: 'partial' });
    expect(screen.getAllByText('Enrich').length).toBeGreaterThan(0);

    renderMenu({ id: 'row-3', captureStatus: 'enriching' });
    expect(screen.getByText('Re-enrich')).toBeDefined();
  });

  it('hides the enrich action entirely for a full link (nothing to re-enrich)', () => {
    renderMenu({ captureStatus: 'full' });
    expect(screen.queryByText('Enrich')).toBeNull();
    expect(screen.queryByText('Re-enrich')).toBeNull();
  });

  it('clicking "Enrich" calls the retry mutation (POSTs /api/links/:id/retry)', async () => {
    renderMenu({ captureStatus: 'partial' });
    fireEvent.click(screen.getByText('Enrich'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/row-1/retry',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('opening the tags fly-out (hover or click) shows the find-tag input and toggle list', () => {
    renderMenu({ tags: ['mcp'] });
    fireEvent.click(screen.getByText('Tags'));
    expect(screen.getByPlaceholderText('Find tag')).toBeDefined();
    // 'mcp' appears once in the trigger row's count area's sibling list item too.
    expect(screen.getAllByText('mcp').length).toBeGreaterThan(0);
  });

  it('toggling an assigned tag off calls the remove-tag mutation (DELETE)', async () => {
    renderMenu({ tags: ['mcp'] });
    fireEvent.click(screen.getByText('Tags'));

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

  it('keeps the tags fly-out open when the pointer moves from the trigger wrapper onto the fly-out (hover race fix)', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderMenu({ tags: ['mcp'] });

    const trigger = screen.getByText('Tags').closest('button') as HTMLButtonElement;
    const wrapper = trigger.parentElement as HTMLElement;
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText('Find tag')).toBeDefined();

    // Pointer leaves the trigger wrapper (schedules a delayed close)...
    fireEvent.mouseLeave(wrapper);
    // ...then lands on the fly-out itself before the close delay elapses —
    // this must cancel the pending close, not let it fire.
    const flyout = screen.getByPlaceholderText('Find tag').closest('.silo-popover') as HTMLElement;
    fireEvent.mouseEnter(flyout);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByPlaceholderText('Find tag')).toBeDefined();
    vi.useRealTimers();
  });

  it('closes the tags fly-out after the delay when the pointer leaves the trigger and never reaches the fly-out', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderMenu({ tags: ['mcp'] });

    const trigger = screen.getByText('Tags').closest('button') as HTMLButtonElement;
    const wrapper = trigger.parentElement as HTMLElement;
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText('Find tag')).toBeDefined();

    fireEvent.mouseLeave(wrapper);

    // Not yet elapsed: still open.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByPlaceholderText('Find tag')).toBeDefined();

    // Past the delay with neither the wrapper nor the fly-out re-entered:
    // now it closes.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByPlaceholderText('Find tag')).toBeNull();
    vi.useRealTimers();
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
    fireEvent.click(screen.getByText('Tags'));

    await waitFor(() => expect(screen.getByText('design')).toBeDefined());
    fireEvent.click(screen.getByText('design').closest('button') as HTMLButtonElement);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/row-1/tags',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag: 'design' }) }),
      ),
    );
  });

  it('gives every action row a --hov background on hover, not just "tags" (review fix: menuItemStyle() was called with no argument for these rows)', () => {
    renderMenu();

    const openRow = screen.getByText('Open in new tab').closest('a') as HTMLElement;
    expect(openRow.style.background).not.toBe('var(--hov)');
    fireEvent.mouseEnter(openRow);
    expect(openRow.style.background).toBe('var(--hov)');
    fireEvent.mouseLeave(openRow);
    expect(openRow.style.background).not.toBe('var(--hov)');

    const copyRow = screen.getByText('Copy link').closest('button') as HTMLElement;
    fireEvent.mouseEnter(copyRow);
    expect(copyRow.style.background).toBe('var(--hov)');

    const editRow = screen.getByText('Edit').closest('button') as HTMLElement;
    fireEvent.mouseEnter(editRow);
    expect(editRow.style.background).toBe('var(--hov)');

    const trashRow = screen.getByText('Move to trash').closest('button') as HTMLElement;
    fireEvent.mouseEnter(trashRow);
    expect(trashRow.style.background).toBe('var(--hov)');
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
            <SelectionProvider>
              <RowMenu link={link} />
            </SelectionProvider>
          </RowMenuProvider>
        </QueryClientProvider>
      </div>,
    );

    fireEvent.click(screen.getByText('Copy link'));
    expect(outerHandler).not.toHaveBeenCalled();
  });
});
