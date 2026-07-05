import type { LinkJson } from '../api/types';
import { DayGroupHeading } from './DayGroupHeading';
import { LinkRow } from './LinkRow';

/**
 * One day-bucket's heading + its rows (plan 010 —
 * `Silo-v2.html:106-108`/`:751`). Purely presentational: the bucketing lives
 * in `src/lib/buckets.ts`.
 */
export function DayGroup({ label, links }: { label: string; links: LinkJson[] }) {
  return (
    <div>
      <DayGroupHeading label={label} />
      {links.map((link) => (
        <LinkRow key={link.id} link={link} />
      ))}
    </div>
  );
}
