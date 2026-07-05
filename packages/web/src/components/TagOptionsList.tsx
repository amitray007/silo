import { useState } from 'react';
import type { TagOption } from '../lib/tagOptions';

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
  const rowPadding = size === 'sm' ? '5px 9px' : '6px 9px';
  const notePadding = size === 'sm' ? '4px 9px 2px' : '4px 9px 2px';

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
            gap: 8,
            width: '100%',
            boxSizing: 'border-box',
            border: 0,
            background: hoveredName === opt.name ? 'var(--hov)' : 'none',
            fontFamily: 'inherit',
            textAlign: 'left',
            padding: rowPadding,
            borderRadius: 7,
            fontSize: '0.8rem',
            fontWeight: 400,
            cursor: 'pointer',
            color: opt.active ? 'var(--ink)' : 'var(--mut)',
            transform: 'scale(1)',
          }}
        >
          <span style={{ color: 'var(--ghost)' }}>#</span>
          <span>{opt.name}</span>
          <span
            style={{
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
        <div style={{ padding: notePadding, fontSize: '0.7rem', color: 'var(--ghost)' }}>
          {hidden} more — type to narrow
        </div>
      )}
    </>
  );
}
