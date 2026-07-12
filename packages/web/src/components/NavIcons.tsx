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
      width="18"
      height="18"
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

/**
 * A clean gear/cog glyph (swapped in from the previous sliders/adjust icon —
 * direct user feedback: "change the Settings icon to a gear icon"). A single
 * closed gear-silhouette path (a center hole ring + 8 teeth, drawn as one
 * outline rather than a ring with separate spoke strokes) filled with
 * `currentColor` and no stroke — a first attempt drawing the ring and teeth
 * as SEPARATE stroked primitives left a visible gap between the ring's edge
 * and each tooth's inner end, reading as a disconnected sunburst instead of
 * a gear; a single connected silhouette avoids that gap entirely. The two
 * concentric circles (outer gear body, inner hole) use `fillRule="evenodd"`
 * so the hole actually punches through instead of filling solid.
 */
export function SettingsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.85 1.4h2.3l.32 1.66c.34.1.66.24.97.4l1.4-.94 1.63 1.63-.94 1.4c.16.31.3.63.4.97l1.66.32v2.3l-1.66.32a4.6 4.6 0 0 1-.4.97l.94 1.4-1.63 1.63-1.4-.94a4.6 4.6 0 0 1-.97.4l-.32 1.66h-2.3l-.32-1.66a4.6 4.6 0 0 1-.97-.4l-1.4.94-1.63-1.63.94-1.4a4.6 4.6 0 0 1-.4-.97L1.4 9.15v-2.3l1.66-.32c.1-.34.24-.66.4-.97l-.94-1.4L4.15 2.53l1.4.94c.31-.16.63-.3.97-.4L6.85 1.4Zm1.15 4.1a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
      />
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
      width="18"
      height="18"
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
export function AddIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/**
 * A check-mark glyph for the Trash header's "Empty Now" button's confirm
 * state (`TrashView.tsx`'s `TrashEmptyNowButton`) — the SAME button swaps
 * its icon from `TrashIcon` to this on the first click, reading as "✓
 * Confirm?" before the second click actually empties the trash. Follows the
 * shared nav-icon convention: `viewBox="0 0 16 16"`, `stroke="currentColor"`,
 * `strokeWidth 1.5`, round caps/joins, `aria-hidden` (the button itself
 * carries the label/aria-label).
 */
export function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.2 8.4 6.4 11.6 12.8 4.8" />
    </svg>
  );
}

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
