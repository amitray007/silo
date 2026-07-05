import type { TrashLinkJson } from '../api/types';
import { DayGroupHeading } from './DayGroupHeading';
import { TrashRow } from './TrashRow';

/**
 * One trash day-bucket's heading + its rows (plan 011, V3-5) — shares
 * `DayGroupHeading` with `DayGroup` (the Library equivalent) but renders
 * `TrashRow` instead of `LinkRow` and threads `purgeWindowDays` down for the
 * countdown.
 */
export function TrashDayGroup({
  label,
  links,
  purgeWindowDays,
}: {
  label: string;
  links: TrashLinkJson[];
  purgeWindowDays: number;
}) {
  return (
    <div>
      <DayGroupHeading label={label} />
      {links.map((link) => (
        <TrashRow key={link.id} link={link} purgeWindowDays={purgeWindowDays} />
      ))}
    </div>
  );
}
