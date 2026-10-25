import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { SettingsView } from '../routes/SettingsView';
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
          <AuthProvider>
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
                <Route path="/settings/:tab" element={<SettingsView />} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AppFrame', () => {
  beforeEach(() => {
    // `AuthProvider`'s mount-time `GET /api/auth/check` also lands on this
    // mock — a Counts-shaped body has no `authRequired` key, so it classifies
    // as falsy/'open' (no gate), which is what every pre-existing test here
    // assumes (Sidebar renders unconditionally, no Log out row).
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
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();

      fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
      expect(screen.getByRole('button', { name: /^light$/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^dark$/i })).toBeDefined();
    });

    it('keeps the outlet and URL behind the Settings modal', () => {
      renderAppFrame();
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
      expect(screen.getByText('outlet content')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.getByTestId('current-path').textContent).toBe('/');
    });

    it('Escape returns from the Settings modal', () => {
      renderAppFrame();
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
      expect(screen.getByText('outlet content')).toBeDefined();
    });

    it('clicking inside the modal leaves Settings open', () => {
      renderAppFrame();
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      fireEvent.click(screen.getByRole('dialog', { name: 'Settings' }));
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    });

    it('switches tabs via the underlined tab strip (opens on Plugins by default, matching v3)', () => {
      renderAppFrame();

      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      expect(screen.getAllByText('Hacker News').length).toBeGreaterThan(0);
      expect(screen.queryByText(/plugins add inline detail/i)).toBeNull();

      fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
      expect(screen.getByText(/match the app to light or dark/i)).toBeDefined();

      fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
      expect(screen.getByText(/let an agent add, search, and read your links/i)).toBeDefined();
    });

    it('opening Settings closes an already-open Edit modal (mutual exclusion — no two stacked scrim modals)', () => {
      renderAppFrame(['/probe']);

      // Open the Edit modal (via the probe's real useRowMenu().openEdit).
      fireEvent.click(screen.getByText('open edit'));
      expect(screen.getByRole('dialog', { name: /edit link/i })).toBeDefined();

      // Now open Settings from the sidebar — the Edit modal must close, so the
      // two focus-trapped scrim modals never coexist (each registers its own
      // capture-phase Escape listener; both open at once = double-close bugs).
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));

      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
      expect(screen.queryByRole('dialog', { name: /edit link/i })).toBeNull();
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

    fireEvent.click(screen.getByRole('link', { name: /settings/i }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
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
  describe('command palette mutual exclusion (review fix #1, plan 024)', () => {
    /** Routes fetch by path so the palette's own hooks (useTags/useSearchLinks/useLinksByTag/useInfiniteLinks) get sane, empty responses instead of the counts-shaped default every other AppFrame test uses — needed here because these tests actually open the palette, not just probe row-menu/selection state. */
    /** The per-URL routing table for `mockAppFrameFetch`, split out purely to keep that function's cognitive complexity under the lint ceiling. */
    function respondToAppFrameUrl(url: string): Response {
      if (url.startsWith('/api/counts')) {
        return jsonResponse({ live: 0, trash: 0, purgeWindowDays: 30 });
      }
      if (url.startsWith('/api/tags')) {
        return jsonResponse({ tags: [] });
      }
      if (url.startsWith('/api/links')) {
        return jsonResponse({ links: [] });
      }
      return jsonResponse({ error: 'not_found', message: url }, 404);
    }

    function mockAppFrameFetch() {
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        return Promise.resolve(respondToAppFrameUrl(url));
      });
    }

    function pressCmdK() {
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
    }

    it('opening the palette (⌘K) while the row ⋯ menu is open closes the menu', () => {
      mockAppFrameFetch();
      renderAppFrame(['/probe']);

      fireEvent.click(screen.getByText('open menu'));
      expect(screen.getByText('menu: row-1')).toBeDefined();

      pressCmdK();

      expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeDefined();
      expect(screen.getByText('menu: none')).toBeDefined();
    });

    it('⌘K while the Edit modal is open does NOT open the palette (the palette yields to a real ModalShell overlay, never stacking two)', () => {
      mockAppFrameFetch();
      renderAppFrame(['/probe']);

      fireEvent.click(screen.getByText('open edit'));
      expect(screen.getByRole('dialog', { name: /edit/i })).toBeDefined();

      pressCmdK();

      // Still exactly ONE dialog — Edit, untouched. The palette never
      // stacked on top (which would have meant two ModalShell instances,
      // each with its own capture-phase Escape listener, fighting).
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs).toHaveLength(1);
      expect(dialogs[0]?.getAttribute('aria-label')).toMatch(/edit/i);
    });

    it('allows search from the Settings modal', () => {
      mockAppFrameFetch();
      renderAppFrame();
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      pressCmdK();
      expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeDefined();
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    });

    it('opening Settings closes the previous search palette', () => {
      mockAppFrameFetch();
      renderAppFrame();
      pressCmdK();
      fireEvent.click(screen.getByRole('link', { name: /settings/i }));
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    });
  });

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
