import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AppFrame } from './AppFrame';
import { useRowMenu } from './RowMenuContext';
import { useLibrarySelection, useTrashSelection } from './SelectionContext';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A stand-in outlet content for the Escape-coordination tests below — pokes
 * the real `useRowMenu`/`useLibrarySelection`/`useTrashSelection` contexts
 * `AppFrame` mounts (so this exercises the SAME `RowMenuLayer` production
 * code every real route runs through) without needing a full `LibraryView`/
 * `TrashView` render (those need mocked fetch responses for every hook they
 * call — this keeps the Escape-priority tests focused on just the
 * coordination logic).
 */
function EscapeProbe() {
  const { openMenuId, toggleMenu } = useRowMenu();
  const librarySelection = useLibrarySelection();
  const trashSelection = useTrashSelection();

  return (
    <div>
      <span>menu: {openMenuId ?? 'none'}</span>
      <span>library selected: {librarySelection.selected.length}</span>
      <span>trash selected: {trashSelection.selected.length}</span>
      <button type="button" onClick={() => toggleMenu('row-1')}>
        open menu
      </button>
      <button type="button" onClick={() => librarySelection.toggle('a')}>
        select library row
      </button>
      <button type="button" onClick={() => trashSelection.toggle('b')}>
        select trash row
      </button>
    </div>
  );
}

function renderAppFrame(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route element={<AppFrame />}>
              <Route path="/" element={<div>outlet content</div>} />
              <Route path="/trash" element={<div>trash content</div>} />
              <Route path="/probe" element={<EscapeProbe />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AppFrame', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the sidebar, the theme toggle, and the routed outlet content', () => {
    renderAppFrame();

    expect(screen.getAllByText('silo').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /library/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^light$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^dark$/i })).toBeDefined();
    expect(screen.getByText('outlet content')).toBeDefined();
  });

  it('the ☰ button starts closed with correct a11y wiring', () => {
    renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(menuButton.getAttribute('aria-controls')).toBe('silo-drawer');

    const drawer = screen.getByLabelText('Sidebar');
    expect(drawer.getAttribute('data-open')).toBe('false');
    expect(drawer.id).toBe('silo-drawer');
  });

  it('opens the drawer on ☰ click, flipping aria-expanded and data-open', () => {
    renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(menuButton);

    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(menuButton.getAttribute('aria-label')).toMatch(/close menu/i);
    const drawer = screen.getByLabelText('Sidebar');
    expect(drawer.getAttribute('data-open')).toBe('true');
  });

  it('moves focus into the drawer when it opens', () => {
    renderAppFrame();

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const drawer = screen.getByLabelText('Sidebar');
    expect(document.activeElement).toBe(drawer);
  });

  it('closes the drawer on Escape and returns focus to the ☰ button', () => {
    renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(menuButton);
    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('closes the drawer when the scrim is clicked, returning focus to the ☰ button', () => {
    const { container } = renderAppFrame();

    const menuButton = screen.getByRole('button', { name: /open menu/i });
    fireEvent.click(menuButton);

    const scrim = container.querySelector('.silo-scrim');
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim as Element);

    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('false');
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('closes the drawer when a nav item is clicked (route change)', () => {
    renderAppFrame();

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('true');

    fireEvent.click(screen.getByRole('link', { name: /trash/i }));

    expect(screen.getByText('trash content')).toBeDefined();
    expect(screen.getByLabelText('Sidebar').getAttribute('data-open')).toBe('false');
  });

  /**
   * Escape-priority coordination (plan 011, V3-5) — `RowMenuLayer`'s single
   * document `keydown` listener must close an open row menu FIRST, and only
   * fall through to clearing a selection scope when no menu is open. Drives
   * this against the real `RowMenuProvider`/`SelectionProvider` +
   * `RowMenuLayer` that `AppFrame` mounts (via `EscapeProbe`), not a
   * hand-rolled reimplementation of the priority logic.
   */
  describe('Escape priority (row menu > library selection > trash selection)', () => {
    it('closes the row menu on the first Escape, leaving a concurrent library selection untouched', () => {
      renderAppFrame(['/probe']);

      fireEvent.click(screen.getByText('open menu'));
      fireEvent.click(screen.getByText('select library row'));
      expect(screen.getByText('menu: row-1')).toBeDefined();
      expect(screen.getByText('library selected: 1')).toBeDefined();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.getByText('menu: none')).toBeDefined();
      // The selection survives this Escape — it only closed the menu.
      expect(screen.getByText('library selected: 1')).toBeDefined();
    });

    it('a second Escape (after the menu is already closed) clears the library selection', () => {
      renderAppFrame(['/probe']);

      fireEvent.click(screen.getByText('open menu'));
      fireEvent.click(screen.getByText('select library row'));
      fireEvent.keyDown(document, { key: 'Escape' }); // closes the menu
      expect(screen.getByText('menu: none')).toBeDefined();

      fireEvent.keyDown(document, { key: 'Escape' }); // now clears the selection

      expect(screen.getByText('library selected: 0')).toBeDefined();
    });

    it('with no menu open, Escape clears the library selection directly', () => {
      renderAppFrame(['/probe']);

      fireEvent.click(screen.getByText('select library row'));
      expect(screen.getByText('library selected: 1')).toBeDefined();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.getByText('library selected: 0')).toBeDefined();
    });

    it('with no menu open and no library selection, Escape clears the trash selection', () => {
      renderAppFrame(['/probe']);

      fireEvent.click(screen.getByText('select trash row'));
      expect(screen.getByText('trash selected: 1')).toBeDefined();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.getByText('trash selected: 0')).toBeDefined();
    });
  });
});
