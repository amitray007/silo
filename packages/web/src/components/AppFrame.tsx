import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/**
 * The full-bleed Oat frame. Unlike the prototype's floating 62rem card, the app
 * fills the whole viewport (`--bg` ground) and the sidebar + content sit as one
 * CENTERED band with generous empty gutters on wide screens — the app owns the
 * window, but the usable content is a narrow, centered column (per the product
 * direction + the reference layouts). No border, no rounded card, no
 * app-in-a-card.
 *
 * Layout: a full-height flex row centered by `justify-content: center`. The
 * sidebar keeps its 210px rail (on `--bg2`, border-right) flush against the
 * content; the content region caps its inner column at a ~720px reading width
 * (see LibraryView / the routed views) so rows never stretch edge-to-edge.
 */
export function AppFrame() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--ink)',
        boxSizing: 'border-box',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {/* The centered band: sidebar (210px) + a ~720px content column sit as one
          unit, capped so equal empty gutters fall on BOTH far sides on wide
          windows (the app owns the window; the usable content is a centered,
          narrow band — not flush-left, not stretched). */}
      <div
        style={{
          display: 'flex',
          width: '100%',
          maxWidth: '60rem',
          minHeight: '100vh',
        }}
      >
        <Sidebar />
        {/* Content region: the routed view fills it, capped at a ~720px reading
            width, with top padding for the omnibar/first group. */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: '18px clamp(20px, 3vw, 34px) 0',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '45rem',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
