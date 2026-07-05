import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { EditModal } from './EditModal';
import { GrainDot } from './GrainDot';
import { RowMenuProvider, useRowMenu } from './RowMenuContext';
import { Sidebar } from './Sidebar';

const DRAWER_ID = 'silo-drawer';

/**
 * Mounted once inside `RowMenuProvider` (plan 011, V3-4) — owns the two
 * document-level listeners v3's root component owns (`clickFn`/the `Escape`
 * branch for `menuId`), and renders the single shared `EditModal` instance
 * when a link is being edited. Living here (not inside `LinkRow`) is what
 * lets ONE `mousedown`/`keydown` listener close whichever row's menu is open
 * regardless of which route rendered it — `RowMenu` itself already stops
 * propagation for clicks INSIDE the popover (`RowMenu.tsx`), so this
 * document-level handler only ever fires for a genuine "outside" click.
 */
function RowMenuLayer() {
  const { openMenuId, closeMenu, editingLink } = useRowMenu();

  useEffect(() => {
    if (openMenuId === null) return;
    const onMouseDown = () => closeMenu();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenuId, closeMenu]);

  return editingLink ? <EditModal link={editingLink} /> : null;
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

  const closeDrawer = () => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
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
              fontSize: '1.1rem',
              cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <GrainDot />
          <span style={{ fontWeight: 500, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>
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

        <Sidebar id={DRAWER_ID} ref={sidebarRef} open={drawerOpen} onNavigate={closeDrawer} />

        {/* Content region: a flex column of two stacked children, both
            supplied by the routed view via <Outlet/> — the header bar
            (`ContentHeader`, full width, unscrolled) then `.silo-content-body`
            (the scrolling region, reading-column-capped inside). Keeping the
            header out of AppFrame lets each route own its own title/count/
            right slot without AppFrame needing route-specific knowledge.
            `RowMenuProvider` wraps the outlet (plan 011, V3-4) so the row `⋯`
            menu + edit-modal state is shared by every routed view — see
            `RowMenuContext.tsx`'s doc comment for why this lives here and not
            per-route. `RowMenuLayer` renders the single shared `EditModal`
            instance and owns the document-level close listeners. */}
        <main className="silo-content">
          <RowMenuProvider>
            <Outlet />
            <RowMenuLayer />
          </RowMenuProvider>
        </main>
      </div>
    </div>
  );
}
