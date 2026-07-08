import { SearchIcon } from './NavIcons';

/**
 * The Library content-header box (`Silo-v3.html` lines 76-94, plan 011 V3-2;
 * made fully non-interactive by a later user-feedback pass) — a static,
 * inert hint reading "Paste a link to keep" with the search-magnifier glyph,
 * matching the box model of the original interactive omnibar exactly
 * (`width:clamp(320px,52%,620px)`, `gap:var(--s2-5)`, `border-radius:11px`,
 * `padding:var(--s3) var(--s4)`, `--bg2` fill, `--line` border) so the header
 * layout doesn't shift.
 *
 * This is now display-only: no input, no focus/keydown handling, no
 * search-opening or capture behavior of its own. It used to be a controlled
 * `<input>` that both drove the command palette's ⌘K focus target AND wired
 * Enter-to-keep for URL-looking text — both roles have since moved
 * elsewhere:
 *
 * - Search lives entirely in the command palette (⌘K / `/` / the sidebar's
 *   Search nav item), not this box.
 * - Paste-to-capture already works via the document-level ⌘V listener
 *   (`usePasteCapture`, mounted once in `AppFrame`) — pasting a URL ANYWHERE
 *   on the page silently captures it, so this box never needed to be a real
 *   text field to make that work.
 *
 * A plain `<div>` (not a `<button>`/`<input>`) — nothing here is clickable,
 * focusable, or keyboard-operable, and it carries no interactive ARIA role.
 */
export function Omnibar() {
  return (
    <div
      style={{
        width: 'clamp(320px, 52%, 620px)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2-5)',
        border: '1px solid var(--line)',
        borderRadius: 11,
        background: 'var(--bg2)',
        padding: 'var(--s3) var(--s4)',
      }}
    >
      <SearchIcon />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '0.92rem',
          color: 'var(--fnt)',
        }}
      >
        Paste a link to keep
      </span>
    </div>
  );
}
