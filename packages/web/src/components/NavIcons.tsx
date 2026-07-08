/**
 * The sidebar nav's inline SVG icons (v3, `docs/design/app/Silo-v3.html`):
 * Library (bookmark), Trash (trash can), Settings (gear). 18×18,
 * `viewBox="0 0 16 16"`, `stroke="currentColor"` (so they inherit the nav
 * item's ink/mut color — no hardcoded hex), stroke-width 1.4, round caps/
 * joins — path data copied from the prototype. Bumped from v3's original
 * 15px per the user-feedback polish pass ("icons look too small" — the
 * Orpheus reference, `docs/design/refs/*.png`, uses larger/cleaner icons);
 * the `viewBox` stays `0 0 16 16` so the path data is untouched, only the
 * rendered `width`/`height` grew.
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
