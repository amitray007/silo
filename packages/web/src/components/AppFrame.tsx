import { Outlet } from 'react-router-dom';
import { ThemeToggle } from '../theme/ThemeToggle';
import { Sidebar } from './Sidebar';

/**
 * The Oat outer frame (`docs/design/app/Silo-v2.html`, ~L26-30): a
 * full-viewport `--bg` ground, centered app card (`max-width: 62rem`,
 * `--line` border, 14px radius, overflow hidden) holding the `Sidebar`
 * (210px) beside the routed content pane. The theme toggle sits above the
 * card, top-left, matching the prototype's placement — outside the card so
 * it never competes with in-card chrome.
 */
export function AppFrame() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--ink)',
        boxSizing: 'border-box',
        padding: 'clamp(10px, 3vh, 34px) clamp(8px, 3vw, 28px)',
      }}
    >
      <div style={{ maxWidth: '62rem', margin: '0 auto 12px' }}>
        <ThemeToggle />
      </div>

      <div
        style={{
          maxWidth: '62rem',
          margin: '0 auto',
          border: '1px solid var(--line)',
          borderRadius: 14,
          background: 'var(--bg)',
          overflow: 'hidden',
          display: 'flex',
          minHeight: 'min(46rem, calc(100vh - 68px))',
        }}
      >
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
