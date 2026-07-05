import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
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
  const { openMenuId, toggleMenu, openEdit } = useRowMenu();
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
      <button
        type="button"
        onClick={() => openEdit(makeLink({ id: 'edit-1', url: 'https://example.com/x' }))}
      >
        open edit
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

/** Echoes the current route's pathname into the DOM — lets a test assert the URL DIDN'T change after a click, not just what content rendered. */
function PathProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

function renderAppFrame(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route element={<AppFrame />}>
              <Route
                path="/"
                element={
                  <>
                    <PathProbe />
                    <div>outlet content</div>
                  </>
                }
              />
              <Route path="/trash" element={<div>trash content</div>} />
              <Route path="/probe" element={<EscapeProbe />} />
              <Route path="/settings" element={<div>settings route content</div>} />
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

  it('renders the sidebar and the routed outlet content (the theme toggle now lives in Settings, not the sidebar)', () => {
    renderAppFrame();

    expect(screen.getAllByText('silo').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /library/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^light$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^dark$/i })).toBeNull();
    expect(screen.getByText('outlet content')).toBeDefined();
  });

  describe('Settings modal', () => {
    it('clicking the sidebar Settings nav item opens the modal, with the real theme toggle inside Preferences', () => {
      renderAppFrame();

      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      expect(screen.getByRole('dialog', { name: /settings/i })).toBeDefined();

      fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
      expect(screen.getByRole('button', { name: /^light$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^dark$/i })).toBeDefined();
    });

    it('does NOT navigate to /settings when opening the modal from the sidebar button (per user feedback: Settings is a popover, not a route change)', () => {
      renderAppFrame();
      expect(screen.getByTestId('current-path').textContent).toBe('/');

      fireEvent.click(screen.getByRole('link', { name: /settings/i }));

      expect(screen.getByRole('dialog', { name: /settings/i })).toBeDefined();
      // The underlying route/outlet content is untouched — still "/", not "/settings".
      expect(screen.getByTestId('current-path').textContent).toBe('/');
      expect(screen.getByText('outlet content')).toBeDefined();
    });

    it('Escape closes the Settings modal and restores focus to the trigger', () => {
      renderAppFrame();

      const settingsLink = screen.getByRole('link', { name: /settings/i });
      // jsdom's fireEvent.click doesn't implicitly focus the target the way a
      // real browser click does — focus it explicitly so the modal's
      // focus-restore-on-close has a real "trigger" element to return to.
      settingsLink.focus();
      fireEvent.click(settingsLink);
      expect(screen.getByRole('dialog', { name: /settings/i })).toBeDefined();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('dialog', { name: /settings/i })).toBeNull();
      expect(document.activeElement).toBe(settingsLink);
    });

    it('clicking the scrim closes the Settings modal', () => {
      renderAppFrame();

      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      const dialog = screen.getByRole('dialog', { name: /settings/i });

      // The scrim is `dialog.parentElement` (the fixed-inset backdrop `SettingsModal` renders around the panel).
      fireEvent.click(dialog.parentElement as Element);

      expect(screen.queryByRole('dialog', { name: /settings/i })).toBeNull();
    });

    it('switches tabs via the underlined tab strip (opens on Plugins by default, matching v3)', () => {
      renderAppFrame();

      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      expect(screen.getByText(/plugins add inline detail/i)).toBeDefined();

      fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
      expect(screen.getByText(/oat, in two lights/i)).toBeDefined();

      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
      expect(screen.getByText(/let an agent add, search, and read your links/i)).toBeDefined();
    });

    it('opening Settings closes an already-open Edit modal (mutual exclusion — no two stacked scrim modals)', () => {
      renderAppFrame(['/probe']);

      // Open the Edit modal (via the probe's real useRowMenu().openEdit).
      fireEvent.click(screen.getByText('open edit'));
      expect(screen.getByRole('dialog', { name: /edit item/i })).toBeDefined();

      // Now open Settings from the sidebar — the Edit modal must close, so the
      // two focus-trapped scrim modals never coexist (each registers its own
      // capture-phase Escape listener; both open at once = double-close bugs).
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));

      expect(screen.getByRole('dialog', { name: /settings/i })).toBeDefined();
      expect(screen.queryByRole('dialog', { name: /edit item/i })).toBeNull();
    });
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
