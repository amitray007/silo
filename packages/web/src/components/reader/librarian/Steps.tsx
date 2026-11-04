import type { UIMessage } from '@ai-sdk/react';
import { useEffect, useState } from 'react';
import { useLinkUrl } from '../../../api/hooks';
import { deriveDomain, siteName } from '../../../lib/url';
import { Chip } from '../../Chip';
import { ReaderIcon } from '../ReaderIcon';
import { runningLabel, runningStep, type StepRow, stepRows, toolsUsed } from './stepRows';

const HITS_SHOWN = 4;

/**
 * Seconds from the first tool starting to the last one finishing, measured here as the parts
 * arrive. A message loaded from storage never saw its tools run, so it has no duration.
 */
function useToolSeconds(running: boolean): number | null {
  const [span, setSpan] = useState<{ start: number; end: number | null } | null>(null);
  useEffect(() => {
    const now = Date.now();
    setSpan((seen) => {
      if (running) return { start: seen?.start ?? now, end: null };
      return seen && seen.end === null ? { start: seen.start, end: now } : seen;
    });
  }, [running]);
  return span?.end ? Math.max(1, Math.round((span.end - span.start) / 1000)) : null;
}

function HitPill({ id, title }: { id: string; title: string | null }) {
  const { data: url } = useLinkUrl(id);
  const domain = url ? deriveDomain(url) : null;
  return (
    <span className="silo-steps-hit">
      <Chip domain={domain} size={14} />
      {domain ? siteName(domain) : title}
    </span>
  );
}

function Row({ row }: { row: StepRow }) {
  const more = row.hits.length - HITS_SHOWN;
  return (
    <li className="silo-steps-row">
      <span className="silo-steps-icon">
        <ReaderIcon name={row.icon} size={14} />
      </span>
      <span className="silo-steps-label">
        {row.label}
        {row.count !== null && (
          <small>
            {row.count} {row.count === 1 ? 'link' : 'links'}
          </small>
        )}
      </span>
      {row.hits.length > 0 && (
        <span className="silo-steps-hits">
          {row.hits.slice(0, HITS_SHOWN).map((hit) => (
            <HitPill key={hit.id} {...hit} />
          ))}
          {more > 0 && <span className="silo-steps-hit silo-steps-more">+{more}</span>}
        </span>
      )}
    </li>
  );
}

/**
 * The tool steps of one answer. While a tool runs: one shimmering line naming it. Afterwards: a
 * quiet "Used N tools" disclosure that opens into a timeline.
 */
export function Steps({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false);
  const running = runningStep(message);
  const seconds = useToolSeconds(running !== undefined);
  if (running)
    return (
      <div className="silo-reasoning">
        <span className="silo-reasoning-head silo-shimmer">{runningLabel(running)}</span>
      </div>
    );
  const used = toolsUsed(message);
  if (used === 0) return null;
  return (
    <div className="silo-reasoning">
      <button
        type="button"
        className="silo-reasoning-head"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        Used {used} {used === 1 ? 'tool' : 'tools'}
        {seconds !== null && ` · ${seconds}s`}
        <ReaderIcon name="right" size={14} />
      </button>
      {open && (
        <ol className="silo-steps-list">
          {stepRows(message).map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </ol>
      )}
    </div>
  );
}
