import { useState } from 'react';
import { useDeleteNow, useRestoreLink } from '../api/hooks';
import type { TrashLinkJson } from '../api/types';
import { purgeCountdownDays } from '../lib/buckets';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import { Chip } from './Chip';
import { DockRestoreIcon, DockTrashIcon } from './Dock';
import { RowSelectCheckbox } from './RowSelectCheckbox';
import { useTrashSelection } from './SelectionContext';

/**
 * A trash row's restore/delete-now icon buttons (plan 011, V3-5) — matches
 * `Silo-v3.html:193-194`'s two ghost icon buttons exactly (restore's
 * counter-clockwise-arrow SVG, delete-now's trash-can SVG), both
 * `onMouseDown`-stopped the same way the row's own checkbox/menu buttons are
 * elsewhere in this app (so a click never bubbles into the row's `<a>` and
 * navigates away).
 *
 * Acting on a row individually also drops it from the trash selection
 * (`deselect([id])`, review fix) — otherwise selecting a row's checkbox and
 * then clicking that same row's own restore/delete-now button would remove
 * the row but leave its now-dead id in the selection, inflating the dock's
 * "N selected" count and letting a later bulk action fire against a
 * no-longer-present id.
 */
function TrashRowActions({ id }: { id: string }) {
  const restore = useRestoreLink(id);
  const deleteNow = useDeleteNow(id);
  const selection = useTrashSelection();
  const busy = restore.isPending || deleteNow.isPending;

  const iconButtonStyle: React.CSSProperties = {
    flex: 'none',
    display: 'grid',
    placeItems: 'center',
    width: 26,
    height: 26,
    border: 0,
    borderRadius: 6,
    background: 'none',
    lineHeight: 1,
    color: 'var(--ghost)',
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.5 : 1,
    padding: 0,
    fontFamily: 'inherit',
  };

  return (
    <>
      <button
        type="button"
        title="restore"
        aria-label="restore"
        disabled={busy}
        className="silo-trash-row-icon"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (busy) return;
          selection.deselect([id]);
          restore.mutate();
        }}
        style={iconButtonStyle}
      >
        <DockRestoreIcon />
      </button>
      <button
        type="button"
        title="delete now"
        aria-label="delete now"
        disabled={busy}
        className="silo-trash-row-icon"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (busy) return;
          selection.deselect([id]);
          deleteNow.mutate();
        }}
        style={iconButtonStyle}
      >
        <DockTrashIcon />
      </button>
    </>
  );
}

/**
 * The Trash screen's row (plan 011, V3-5 — `Silo-v3.html:181-195`): chip,
 * title, domain suffix, the `◷ {left}` purge countdown in `--warn`, then the
 * restore/delete-now icon buttons. Simpler than `LinkRow` on purpose — no
 * marks, no note line, no `⋯` menu (trash rows have exactly two actions, both
 * always reachable as icon buttons rather than tucked behind a menu).
 *
 * The row is still a real link out to `link.url` (matching v3, which keeps
 * the whole row an `<a>`) so "what was this" stays one click away even from
 * the trash. `purgeWindowDays` is passed down from `TrashView` (sourced from
 * `useCounts()`, the one place the read-only purge window is exposed) rather
 * than refetched per row.
 */
export function TrashRow({
  link,
  purgeWindowDays,
}: {
  link: TrashLinkJson;
  purgeWindowDays: number;
}) {
  const [hovered, setHovered] = useState(false);
  const selection = useTrashSelection();
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const isSelected = selection.isSelected(link.id);
  const anySelected = selection.selected.length > 0;
  const showCheck = hovered || anySelected;
  const left = purgeCountdownDays(link.deletedAt, purgeWindowDays);

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s3)',
        // K3 (oat-conformance audit): was '9px 11px' — LinkRow's `.silo-link-row`
        // (base.css) rounds its own `10px 11px` to the same `var(--s2-5)`
        // token, so both rows now share the IDENTICAL row padding and render
        // at the same height (the drift this increment's audit flagged).
        padding: 'var(--s2-5) var(--s2-5)',
        borderRadius: 8,
        background: hovered || isSelected ? 'var(--hov)' : 'transparent',
        textDecoration: 'none',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      <RowSelectCheckbox
        visible={showCheck}
        isSelected={isSelected}
        onToggle={() => selection.toggle(link.id)}
      />
      {!showCheck && <Chip domain={domain} />}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--s2-5)',
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: 'var(--text-base)',
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 'var(--text-base)',
            color: 'var(--fnt)',
            whiteSpace: 'nowrap',
            fontWeight: 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '14rem',
          }}
        >
          {domain}
        </span>
      </span>
      <span
        title={`auto-deletes in ${left} days`}
        style={{
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--s1-5)',
          fontSize: '0.74rem',
          fontWeight: 500,
          color: 'var(--warn)',
        }}
      >
        <span style={{ fontSize: '0.84rem', lineHeight: 1 }}>◷</span>
        {left}d
      </span>
      <TrashRowActions id={link.id} />
    </a>
  );
}
