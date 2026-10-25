/**
 * The sidebar nav's inline SVG icons (v3, `docs/design/app/Silo-v3.html`):
 * Library (bookmark), Trash (trash can), Settings (gear), Log out (door +
 * arrow). 18×18, `viewBox="0 0 16 16"`, `stroke="currentColor"` (so they
 * inherit the nav item's ink/mut color — no hardcoded hex), stroke-width
 * 1.4, round caps/joins — path data copied from the prototype (Log out is a
 * new glyph drawn to match, since the prototype predates the auth cookie
 * upgrade's Log out row). Bumped from v3's original 15px per the
 * user-feedback polish pass ("icons look too small" — the Orpheus reference,
 * `docs/design/refs/*.png`, uses larger/cleaner icons); the `viewBox` stays
 * `0 0 16 16` so the path data is untouched, only the rendered
 * `width`/`height` grew.
 */

export function LibraryIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.4h8a.6.6 0 0 1 .6.6v10.6l-4.6-2.8-4.6 2.8V3a.6.6 0 0 1 .6-.6Z" />
    </svg>
  );
}

/**
 * The trash-can glyph — `size`/`stroke` are overridable (defaulting to the
 * sidebar nav rail's 18px/`currentColor`) so `Dock.tsx`'s `DockTrashIcon`
 * (12px, `var(--ghost)`, used in the docks' "move to trash"/"empty all"/
 * "delete now" buttons and `TrashRowActions`' delete-now button) can reuse
 * this exact path data instead of duplicating the SVG (jscpd guards
 * production src at 1.5%).
 */
export function TrashIcon({
  size = 18,
  stroke = 'currentColor',
}: {
  size?: number;
  stroke?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={stroke}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.8 4.2h10.4" />
      <path d="M6 4.2V2.8h4v1.4" />
      <path d="M4.3 4.2l.6 9h6.2l.6-9" />
      <path d="M6.6 7v3.8M9.4 7v3.8" />
    </svg>
  );
}

/** Settings uses Shiori's sliders icon. */
export function SettingsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 4h3m4 0h5M2 12h6m4 0h2" />
      <circle cx="7" cy="4" r="2" />
      <circle cx="10" cy="12" r="2" />
    </svg>
  );
}

/**
 * A door + arrow-out glyph for the sidebar's Log out row (Unit 6, the
 * cookie-session auth upgrade): an open door frame (a partial rect, left
 * edge omitted so it reads as an open doorway) with an arrow exiting through
 * it. Stroked, not filled — matches Library/Trash's stroke convention
 * (`stroke="currentColor"`, `strokeWidth 1.4`, round caps/joins) rather than
 * Settings' filled-silhouette gear, since a door-and-arrow reads cleanly as
 * an outline at this size where a filled version would clot into a blob.
 */
export function LogOutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 2.4H3.6a.6.6 0 0 0-.6.6v10a.6.6 0 0 0 .6.6H7" />
      <path d="M10.2 5.2 13 8l-2.8 2.8" />
      <path d="M13 8H6" />
    </svg>
  );
}

/**
 * A clipboard-paste glyph for the Library header's "paste to capture" button
 * (`LibraryView.tsx`'s `PasteCaptureButton`) — a clipboard body (the
 * rectangle + its top clip tab) with a small downward arrow inside, so it
 * reads distinctly as PASTE (content going IN) rather than the generic
 * copy-a-clipboard icon most icon sets reuse for both actions. Follows the
 * shared nav-icon convention: `viewBox="0 0 16 16"`, 16px render size,
 * `stroke="currentColor"` (inherits the button's idle/hover color, no
 * hardcoded hex), `strokeWidth 1.4`, round caps/joins, `aria-hidden` (the
 * button itself carries the `aria-label`).
 */
/**
 * A clean `+` glyph for the Library "Add" capture button. The button carries a
 * visible "Add" label, so the icon just needs to read as "add" at a glance — a
 * plus is crisper at 16px than the busier clipboard/paste glyph it replaced.
 */
/**
 * The magnifier glyph shared by every search-style input's leading icon —
 * `Omnibar` and the Trash screen's search input (`TrashView.tsx`'s
 * `TrashSearchInput`) both render this exact 15×15 `stroke="var(--ghost)"`
 * SVG (path data copied from the prototype). Pulled out so the two call
 * sites don't each carry their own copy (jscpd guards production src at
 * 1.5%) — the icon itself is identical everywhere it's used; only the
 * surrounding input shell differs per screen, so only the glyph moves here.
 *
 * `size`/`stroke` are overridable (mirroring `TrashIcon`'s own pattern),
 * defaulting to the original 15px/`var(--ghost)` so every existing caller is
 * unaffected — the sidebar's Search nav item (plan 024) is the first caller
 * to override both, sizing up to 18px/`currentColor` to match Library/Trash's
 * nav-row icon convention.
 */
export function SearchIcon({
  size = 15,
  stroke = 'var(--ghost)',
}: {
  size?: number;
  stroke?: string;
} = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={stroke}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
      aria-hidden="true"
    >
      <title>Search</title>
      <circle cx="7" cy="7" r="4.3" />
      <path d="m10.3 10.3 3 3" />
    </svg>
  );
}
