import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useCommandPalette } from '../lib/useCommandPalette';
import { usePasteCapture } from '../lib/usePasteCapture';
import { ThemeSettingsSync } from '../theme/ThemeSettingsSync';
import { CommandPalette } from './CommandPalette';
import { EditModal } from './EditModal';
import { GrainDot } from './GrainDot';
import { HoverPreviewProvider } from './HoverPreviewContext';
import { RowMenuProvider, useRowMenu } from './RowMenuContext';
import { SelectionProvider, useLibrarySelection, useTrashSelection } from './SelectionContext';
import { SettingsProvider, useSettings } from './SettingsContext';
import { SettingsModal } from './SettingsModal';
import { Sidebar } from './Sidebar';

const DRAWER_ID = 'silo-drawer';

/**
 * Mounted once inside `RowMenuProvider` (plan 011, V3-4; extended V3-5 for
 * multi-select) — owns the document-level `Escape`/`mousedown` handling for
 * the row menu AND both selection scopes, and renders the single shared
 * `EditModal` instance when a link is being edited. Living here (not inside
 * `LinkRow`/`TrashRow`) is what lets ONE Escape handler arbitrate between
 * every route's row menu AND its selection dock, rather than each route
 * installing its own and several firing on the same keypress.
 *
 * Scope note: the mobile drawer (`AppFrame` below) keeps its OWN, separate
 * Escape handler (mounted only while the drawer is open) — the two are
 * independent by design: the drawer is mobile-only chrome that owns its own
 * open/close lifecycle, and on the rare overlap (drawer open AND a menu open
 * or selection active) a single Escape dismisses both, which reads fine (the
 * drawer closes, the menu/selection collapses). This handler is authoritative
 * only for the menu-vs-library-vs-trash arbitration below, not for the drawer.
 *
 * Escape's priority within this handler (the build brief's "Esc should close
 * menu if open, else clear selection"): closes the row `⋯` menu first if one
 * is open — closing a menu is the more "local", more recently-opened kind of
 * state — otherwise clears the library selection, otherwise the trash
 * selection. (In practice at most one of these is ever non-empty at a time,
 * but the ordering makes the menu-open + selection-active edge case
 * deterministic: one Escape closes the menu, a second clears the selection.)
 * `mousedown`-outside still only closes the row menu (v3 has no analogous
 * "click outside clears selection" behavior — the docks are dismissed via
 * their own `clear` button or Escape only).
 */
function RowMenuLayer({ palette }: { palette: ReturnType<typeof useCommandPalette> }) {
  const { openMenuId, closeMenu, editingLink, closeEdit } = useRowMenu();
  const librarySelection = useLibrarySelection();
  const trashSelection = useTrashSelection();
  const { open: settingsOpen } = useSettings();

  // Mutual exclusion with the Settings modal (review fix, ce-julik-frontend-
  // races): EditModal and SettingsModal are both centered, scrim'd, focus-
  // trapped dialogs, and each mounts its OWN `ModalShell` with its OWN
  // capture-phase document Escape listener. If both were open at once, a
  // single Escape would fire BOTH listeners (capture-phase siblings on the
  // same node aren't stopped by `stopPropagation`), and two nested scrims/
  // focus-traps would fight. Every other overlapping-overlay pair in this app
  // is made mutually exclusive at the state layer (`openEdit` already clears
  // the row menu) — Settings was the odd one out. The only REACHABLE overlap
  // is "Edit open → user opens Settings from the sidebar": while Settings is
  // up (a full-screen scrim'd modal) the user can't reach a row's ⋯→Edit
  // trigger behind it, so the reverse transition can't happen. Settings is the
  // fresher action there, so it wins — closing the edit modal underneath. This
  // lives here (not in `SettingsLayer`) because `SettingsLayer` renders OUTSIDE
  // `RowMenuProvider` — only this layer can see both `editingLink` and
  // `settingsOpen`.
  useEffect(() => {
    if (settingsOpen && editingLink) {
      closeEdit();
    }
  }, [settingsOpen, editingLink, closeEdit]);

  // Mutual exclusion with the command palette (plan 024 review fix): the
  // palette is ALSO a `ModalShell`-based scrim'd, focus-trapped overlay
  // (`CommandPalette.tsx`), with its own capture-phase Escape listener. Two
  // `ModalShell` overlays open together means TWO capture-phase Escape
  // listeners both firing on one keypress plus nested/fighting scrims —
  // the exact problem the Edit-vs-Settings effect above already guards
  // against. The palette's ⌘K/`/` triggers are GLOBAL keydown listeners
  // that fire regardless of what's already on screen, so every combination
  // is reachable (palette-then-Settings, Settings-then-palette,
  // palette-then-Edit, Edit-then-palette), unlike Edit-vs-Settings where the
  // UI structurally prevents one direction.
  //
  // Rule: the palette YIELDS to any other `ModalShell`-based overlay
  // (Edit/Settings) — it never opens over one, and if one opens while the
  // palette is up, the palette closes. Between two `ModalShell` overlays,
  // "whoever's newest wins" is fine (per the Edit-vs-Settings precedent);
  // here it's simpler and just as correct to make the palette always the
  // one that backs off, since it never holds user input worth preserving.
  //
  // The row `⋯` menu is DIFFERENT in kind: `RowMenu.tsx` is a lightweight
  // popover, not a `ModalShell` (no scrim, no focus-trap, no Escape
  // listener of its own) — there's no dueling-listener risk, so the palette
  // is free to WIN over it (closing the menu) rather than refusing to open.
  useEffect(() => {
    if ((settingsOpen || editingLink) && palette.open) {
      palette.closePalette();
    }
  }, [settingsOpen, editingLink, palette.open, palette.closePalette]);

  useEffect(() => {
    if (palette.open && openMenuId !== null) {
      closeMenu();
    }
  }, [palette.open, openMenuId, closeMenu]);

  useEffect(() => {
    if (openMenuId === null) return;
    const onMouseDown = () => closeMenu();
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openMenuId, closeMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openMenuId !== null) {
        closeMenu();
        return;
      }
      if (librarySelection.selected.length > 0) {
        librarySelection.clear();
        return;
      }
      if (trashSelection.selected.length > 0) {
        trashSelection.clear();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openMenuId, closeMenu, librarySelection, trashSelection]);

  return editingLink ? <EditModal link={editingLink} /> : null;
}

/**
 * Renders the shared `SettingsModal` whenever `useSettings().open` is true
 * (mirrors `RowMenuLayer`'s "layer component reads context, renders the
 * overlay" shape). Lives as its own tiny component — rather than an inline
 * `{settingsOpen && <SettingsModal/>}` in `AppFrame` — purely so `AppFrame`
 * itself doesn't need to call `useSettings()` (it renders `SettingsProvider`
 * around this layer instead, keeping the provider/consumer split explicit).
 *
 * The modal is closed on navigation AWAY from `/settings` by `SettingsView`'s
 * unmount cleanup (not by a route-watching effect here) — see that route's
 * doc comment for why (a route-diff effect here would race the open
 * transition, since opening from the sidebar flips `open` and navigates in
 * the same batch).
 */
function SettingsLayer() {
  const { open } = useSettings();
  return open ? <SettingsModal /> : null;
}

/**
 * The full-bleed Oat frame. Unlike the prototype's floating 62rem card, the app
 * fills the whole viewport (`--bg` ground) and the sidebar + content sit as one
 * CENTERED band with generous empty gutters on wide screens — the app owns the
 * window, but the usable content is a narrow, centered column (per the product
 * direction + the reference layouts). No border-radius, no rounded card,
 * no app-in-a-card — just a left/right wall bounding the band as a column.
 *
 * Layout SHELL lives in CSS classes (`src/styles/base.css`) with `@media`
 * breakpoints, per `docs/rules/web-react.md`: real media queries (not a JS
 * `useMediaQuery` branch) drive the mobile off-canvas drawer, so there is no
 * hydration/first-paint shift. This component only owns the drawer's OPEN
 * STATE + a11y wiring; the visual slide/backdrop/breakpoint are pure CSS.
 *
 * Drawer a11y: the ☰ button carries `aria-expanded` + `aria-controls` +
 * `aria-label` (flips between "Open menu"/"Close menu"); the drawer is a
 * real `<nav aria-label="Sidebar">` (Biome's `useSemanticElements` wants a
 * native landmark element over a `div[role=navigation]`), with `data-open`
 * driving the mobile slide-in — a single stable landmark rather than a role
 * that changes between navigation/dialog. Escape and a scrim tap close it;
 * closing returns focus to the ☰ button; opening moves focus into the
 * drawer. Navigating to a new route also closes the drawer (so tapping a
 * nav item dismisses it on mobile).
 */
export function AppFrame() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);

  // Paste-to-capture (build brief, "Omnibar" item 3) — mounted once at the
  // app root, same as the other document-level singletons below, so a paste
  // anywhere on the page (not just inside the omnibar) can be caught.
  usePasteCapture();

  // The command palette (plan 024) — ONE instance mounted here, alongside
  // the other document-level singletons, so its ⌘K/`/` global listeners
  // exist for the app's whole lifetime rather than per-route. `Sidebar`'s
  // Search nav item and every other trigger call `commandPalette.openPalette`.
  const commandPalette = useCommandPalette();

  const closeDrawer = () => {
    // Only steal focus back to the (offscreen-on-desktop) ☰ button when the
    // drawer was actually open — `Sidebar`'s `onNavigate` calls this after
    // EVERY nav-item click (including Settings, which also opens a modal),
    // not just ones that happened while the drawer was open. Unconditionally
    // focusing here would fight a focus a modal just moved into its own
    // panel (review fix: surfaced by the Settings modal's focus-restore
    // test, which found every desktop nav click was silently re-focusing the
    // hidden ☰ button). The functional updater reads the live pending value,
    // so overlapping calls in one batch each see the correct `open`.
    //
    // Accepted residual (ce-correctness, mobile-only, low severity): if the
    // drawer IS open (mobile) when Settings is tapped, this synchronously
    // refocuses the ☰ button before `SettingsModal`'s `ModalShell` mounts, so
    // the modal captures the ☰ button (not the Settings link) as its
    // focus-restore target. On mobile the ☰ button is the on-screen drawer
    // trigger sitting right there in the topbar, so returning focus to it on
    // close is a reasonable landing spot — not worth threading an explicit
    // trigger element through the shared ModalShell API to "fix".
    setDrawerOpen((open) => {
      if (open) {
        menuButtonRef.current?.focus();
      }
      return false;
    });
  };

  const openDrawer = () => {
    setDrawerOpen(true);
  };

  // Close the drawer whenever the route changes (tapping a nav item should
  // dismiss it on mobile) — but don't fight the initial mount.
  useEffect(() => {
    if (previousPathRef.current !== location.pathname) {
      previousPathRef.current = location.pathname;
      setDrawerOpen(false);
    }
  }, [location.pathname]);

  // Move focus into the drawer when it opens; Escape closes it. Reads
  // `closeDrawer`'s effects inline (rather than depending on the function
  // identity) so the listener always closes + refocuses correctly.
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    sidebarRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    // `SettingsProvider` wraps the whole frame (not just `main`, unlike
    // `RowMenuProvider`/`SelectionProvider`) because the Settings modal is
    // opened from the SIDEBAR's Settings button, which sits outside `main` as
    // a sibling — the sidebar needs `useSettings()` too, so the provider has
    // to sit above both.
    <SettingsProvider>
      {/* Reconciles the persisted `theme` setting in on load (plan 016) — see
          `ThemeSettingsSync`'s doc comment. Renders nothing; mounted once
          here (inside every provider it needs: QueryClientProvider sits
          above AppFrame in main.tsx, ThemeProvider likewise). */}
      <ThemeSettingsSync />
      <div className="silo-frame">
        <div className="silo-band">
          <div className="silo-topbar">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={drawerOpen}
              aria-controls={DRAWER_ID}
              onClick={() => (drawerOpen ? closeDrawer() : openDrawer())}
              className="silo-icon-btn-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                flex: 'none',
                background: 'transparent',
                border: 'none',
                borderRadius: 8,
                color: 'var(--ink)',
                fontSize: 'var(--text-xl)',
                cursor: 'pointer',
              }}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <GrainDot size={24} plate />
            <span
              style={{ fontWeight: 500, fontSize: 'var(--text-lg)', letterSpacing: '-0.015em' }}
            >
              silo
            </span>
          </div>

          {/* The scrim is a pointer-only dismiss affordance (aria-hidden — the
              drawer itself is dismissed via Escape or the ☰ button, both
              already keyboard-operable). */}
          <div
            className="silo-scrim"
            data-open={drawerOpen}
            aria-hidden="true"
            onClick={closeDrawer}
          />

          <Sidebar
            id={DRAWER_ID}
            ref={sidebarRef}
            open={drawerOpen}
            onNavigate={closeDrawer}
            onOpenSearch={commandPalette.openPalette}
          />

          {/* Content region: a flex column of two stacked children, both
              supplied by the routed view via <Outlet/> — the header bar
              (`ContentHeader`, full width, unscrolled) then `.silo-content-body`
              (the scrolling region, reading-column-capped inside). Keeping the
              header out of AppFrame lets each route own its own title/count/
              right slot without AppFrame needing route-specific knowledge.
              `RowMenuProvider` wraps the outlet (plan 011, V3-4) so the row `⋯`
              menu + edit-modal state is shared by every routed view — see
              `RowMenuContext.tsx`'s doc comment for why this lives here and not
              per-route. `SelectionProvider` (V3-5) does the same for the two
              multi-select scopes (library/trash) — see `SelectionContext.tsx`'s
              doc comment. `HoverPreviewProvider` (V3-8) does the same for the
              single shared hover-preview card — see
              `HoverPreviewContext.tsx`'s doc comment. `RowMenuLayer` renders
              the single shared `EditModal` instance and owns the
              document-level close/Escape-priority listeners for both. */}
          <main className="silo-content">
            <RowMenuProvider>
              <SelectionProvider>
                <HoverPreviewProvider>
                  <Outlet />
                  <RowMenuLayer palette={commandPalette} />
                </HoverPreviewProvider>
              </SelectionProvider>
            </RowMenuProvider>
          </main>
        </div>
        <SettingsLayer />
        <CommandPalette palette={commandPalette} />
      </div>
    </SettingsProvider>
  );
}
