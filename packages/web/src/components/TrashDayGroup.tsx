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
  onDelete,
}: {
  label: string;
  links: TrashLinkJson[];
  purgeWindowDays: number;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <DayGroupHeading label={label} />
      {links.map((link) => (
        <TrashRow key={link.id} link={link} purgeWindowDays={purgeWindowDays} onDelete={onDelete} />
      ))}
    </div>
  );
}
