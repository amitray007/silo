import type { LinkJson } from '../api/types';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import { Chip } from './Chip';
import { Mark, type MarkKind } from './Mark';

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
 * The read-only Library row (plan 010 — `Silo-v2.html:110-136`,
 * `render-rows-*.png`). The whole row is a link out to `link.url`; write
 * chrome (the ⋯ menu, hover-meta, multi-select, tags/edit/trash) is
 * deliberately deferred to a later slice.
 *
 * Marks: up to three can co-occur (note + claude + enriching/degraded) — each
 * is an independent flag except the capture-status mark, which is one of
 * three states (or none, on a healthy `full` link).
 */
export function LinkRow({ link }: { link: LinkJson }) {
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const statusMark = captureStatusMark(link.captureStatus);

  return (
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
  );
}
