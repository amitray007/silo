import type { LinkJson } from '../api/types';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import { Chip } from './Chip';
import { Mark, type MarkKind } from './Mark';
import { RowMenu } from './RowMenu';
import { useRowMenu } from './RowMenuContext';

/**
 * The capture-status mark for a row — mutually exclusive with itself (a link
 * has exactly one `captureStatus`), but composed alongside the independent
 * note/claude marks below. `'full'` (healthy) deliberately yields no mark —
 * "silence means complete" (CLAUDE.md "Design fidelity").
 */
function captureStatusMark(captureStatus: LinkJson['captureStatus']): MarkKind | null {
  switch (captureStatus) {
    case 'enriching':
      return 'enriching';
    case 'partial':
    case 'bare':
      return 'degraded';
    default:
      return null;
  }
}

/**
 * The Library row (plan 010 — `Silo-v2.html:110-136`, `render-rows-*.png`;
 * write chrome added plan 011 V3-4). The whole row is a link out to
 * `link.url`; the `⋯` button (always rendered, ghost→ink on hover, matching
 * v3) opens `RowMenu` for THIS row via the shared `useRowMenu()` context — see
 * `RowMenuContext.tsx`'s doc comment for why the open/edit state lives there
 * rather than per-route. The `⋯` button's `onMouseDown` stops propagation so
 * the click never reaches the row's `<a>` (no accidental navigation) before
 * `onClick` toggles the menu; the outer wrapping `<span>` is `position:
 * relative` so `RowMenu`'s `position:absolute` anchors to this row, not the
 * whole list.
 *
 * Marks: up to three can co-occur (note + claude + enriching/degraded) — each
 * is an independent flag except the capture-status mark, which is one of
 * three states (or none, on a healthy `full` link).
 */
export function LinkRow({ link }: { link: LinkJson }) {
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const statusMark = captureStatusMark(link.captureStatus);
  const { openMenuId, toggleMenu } = useRowMenu();
  const menuOpen = openMenuId === link.id;

  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <a href={link.url} target="_blank" rel="noopener" className="silo-link-row">
        <span style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <Chip domain={domain} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 11 }}>
            <span
              style={{
                fontWeight: 500,
                fontSize: '0.88rem',
                color: link.captureStatus === 'enriching' ? 'var(--fnt)' : 'var(--ink)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </span>
            {(statusMark || link.notes || link.addedBy === 'agent') && (
              <span style={{ flex: 'none', display: 'inline-flex', gap: 5 }}>
                {link.notes && <Mark kind="note" />}
                {link.addedBy === 'agent' && <Mark kind="claude" />}
                {statusMark && <Mark kind={statusMark} />}
              </span>
            )}
            <span
              style={{
                flex: 'none',
                maxWidth: '14rem',
                fontSize: '0.84rem',
                color: 'var(--fnt)',
                fontWeight: 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {domain}
            </span>
          </span>
          <button
            type="button"
            title="options"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleMenu(link.id);
            }}
            style={{
              flex: 'none',
              border: 0,
              background: 'none',
              fontSize: '0.9rem',
              lineHeight: 1,
              color: menuOpen ? 'var(--ink)' : 'var(--ghost)',
              cursor: 'pointer',
              padding: '2px 4px',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
            ⋯
          </button>
        </span>
        {link.notes && (
          <span
            style={{
              display: 'block',
              padding: '2px 20px 0 31px',
              fontSize: '0.8rem',
              color: 'var(--mut)',
              fontStyle: 'italic',
            }}
          >
            "{link.notes}"
          </span>
        )}
      </a>
      {menuOpen && <RowMenu link={link} />}
    </span>
  );
}
