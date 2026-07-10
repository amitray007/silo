import { useState } from 'react';
import type { TagOption } from '../lib/tagOptions';

/**
 * The find-tag input styling shared by `RowMenu`'s `TagsFlyout` and
 * `EditModal`'s `EditTagsFlyout` — same `silo-field` box (border/radius/bg/
 * font), only the bottom margin differs (RowMenu's `var(--s1)` vs
 * EditModal's un-tokenized 3px, which has no clean `--s*` match between
 * `--s-0-5`/2px and `--s1`/4px — see `EditTagsFlyout`'s own K3 comment).
 * Takes `margin` as a param rather than forking the whole style object
 * (jscpd guards production src at 1.5%).
 */
export function tagSearchFieldStyle(margin: string): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    margin,
    padding: 'var(--s1-5) var(--s2)',
    border: '1px solid var(--line)',
    borderRadius: 7,
    background: 'var(--bg2)',
    color: 'var(--ink)',
    font: 'inherit',
    fontSize: 'var(--text-sm)',
    outline: 'none',
  };
}

/**
 * The shared toggle-list row rendered inside both `RowMenu`'s `TagsFlyout`
 * and `EditModal`'s `EditTagsFlyout` (plan 011, V3-4) — pulled out once both
 * popovers needed the exact same "# {name} · active dot" button (`jscpd`
 * flagged the inline duplicate at >1.5% production `tsx` duplication; this
 * component is the fix, not a workaround). `size` picks the two popovers'
 * slightly different paddings/font-sizes (v3's row-menu tags fly-out vs. the
 * edit modal's wider tags picker) without forking the whole row.
 *
 * Hover feedback (`--hov` background on the hovered row) added per the
 * RowMenu redesign (build brief item 11: "the tags hover all look bad") —
 * previously every row was flat/inert until clicked, which read as broken
 * rather than interactive.
 */
export function TagOptionsList({
  opts,
  hidden,
  size = 'sm',
  onToggle,
}: {
  opts: TagOption[];
  hidden: number;
  size?: 'sm' | 'md';
  onToggle: (name: string, active: boolean) => void;
}) {
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  // `md` (both current call sites: `RowMenu`'s `TagsFlyout` and `EditModal`'s
  // `EditTagsFlyout`) is tokenized to sit closer to the main `RowMenu`
  // popover's own row rhythm (`--s2-5 --s3`, i.e. 10px 12px) — was a
  // hardcoded `6px 9px`, visibly tighter/cramped next to the redesigned main
  // menu it now sits beside. `sm` is kept for any future denser use.
  const rowPadding = size === 'sm' ? '5px 9px' : 'var(--s2) var(--s2-5)';
  const notePadding = size === 'sm' ? '4px 9px 2px' : 'var(--s2) var(--s2-5) var(--s1)';

  return (
    <>
      {opts.map((opt) => (
        <button
          key={opt.name}
          type="button"
          aria-pressed={opt.active}
          className="silo-tag-option"
          onClick={() => onToggle(opt.name, opt.active)}
          onMouseEnter={() => setHoveredName(opt.name)}
          onMouseLeave={() => setHoveredName((current) => (current === opt.name ? null : current))}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s2)',
            width: '100%',
            boxSizing: 'border-box',
            border: 0,
            background: hoveredName === opt.name ? 'var(--hov)' : 'none',
            fontFamily: 'inherit',
            textAlign: 'left',
            padding: rowPadding,
            borderRadius: 7,
            fontSize: 'var(--text-sm)',
            fontWeight: 400,
            cursor: 'pointer',
            // Brightened inactive from `--mut` to `--ink` (direct user
            // feedback): this is a primary clickable tag-picker label — the
            // active/inactive distinction is already carried by the trailing
            // dot marker below (`opt.active ? 'var(--mark)' : 'transparent'`)
            // plus the row's own hover fill, so dimming the LABEL text on top
            // of that was redundant and read as muddy, same reasoning as
            // `NavItem`'s `default`/`tag` variants.
            color: 'var(--ink)',
            transform: 'scale(1)',
          }}
        >
          <span style={{ flex: 'none', color: 'var(--ghost)' }}>#</span>
          {/* Truncates instead of overflowing the popover — a long tag name
              (e.g. pasted/scraped text mistaken for a tag) used to blow past
              this row's fixed-width container with no wrap/ellipsis at all
              (bug report: a ~45-char tag overran the flyout entirely).
              `minWidth: 0` is required alongside `flex: 1` for the
              `text-overflow: ellipsis` to actually kick in inside a flex
              row — without it the flex item refuses to shrink below its
              content's intrinsic width and the overflow: hidden never bites. */}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.name}
          </span>
          <span
            style={{
              flex: 'none',
              marginLeft: 'auto',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: opt.active ? 'var(--mark)' : 'transparent',
            }}
          />
        </button>
      ))}
      {hidden > 0 && (
        <div style={{ padding: notePadding, fontSize: 'var(--text-xs)', color: 'var(--fnt)' }}>
          {hidden} more — type to narrow
        </div>
      )}
    </>
  );
}
