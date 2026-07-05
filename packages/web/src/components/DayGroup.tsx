import type { LinkJson } from '../api/types';
import { LinkRow } from './LinkRow';

/**
 * One day-bucket's heading + its rows (plan 010 —
 * `Silo-v2.html:106-108`/`:751`). Purely presentational: the bucketing lives
 * in `src/lib/buckets.ts`.
 */
export function DayGroup({ label, links }: { label: string; links: LinkJson[] }) {
  return (
    <div>
      <p
        style={{
          fontSize: '0.78rem',
          fontWeight: 500,
          color: 'var(--ghost)',
          padding: '20px 11px 6px',
          margin: 0,
        }}
      >
        {label}
      </p>
      {links.map((link) => (
        <LinkRow key={link.id} link={link} />
      ))}
    </div>
  );
}
