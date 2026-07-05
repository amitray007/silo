import type { LinkJson, TrashLinkJson } from '../api/types';

/** The Library's day-group labels, in display order (plan 010). */
const DAY_BUCKET_LABELS = ['Today', 'Yesterday', 'This week', 'Earlier'] as const;

type DayBucketLabel = (typeof DAY_BUCKET_LABELS)[number];

export type DayBucket = { label: DayBucketLabel; items: LinkJson[] };

/**
 * The Trash screen's day-group labels (plan 011, V3-5) — v3's `delBucket`
 * (`Silo-v3.html:843`) adds a `This month` bucket between `This week` and
 * `Earlier` that the Library grouping doesn't have, so it's a DISTINCT label
 * set rather than reusing `DAY_BUCKET_LABELS`.
 */
const TRASH_BUCKET_LABELS = ['Today', 'Yesterday', 'This week', 'This month', 'Earlier'] as const;

type TrashBucketLabel = (typeof TRASH_BUCKET_LABELS)[number];

export type TrashDayBucket = { label: TrashBucketLabel; items: TrashLinkJson[] };

/** Floors a `Date` to LOCAL midnight (mirrors the prototype's `delBucket` day-math — a calendar-day boundary, not a rolling 24h window). */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar-day delta (today minus a floored-to-local-midnight day) between `now` and `date`, rounded to the nearest whole day. Shared by both bucketing functions below. */
function calendarDayDelta(date: Date, now: Date): number {
  const today = startOfLocalDay(now);
  const day = startOfLocalDay(date);
  return Math.round((today.getTime() - day.getTime()) / MS_PER_DAY);
}

/**
 * Maps a calendar-day delta (today minus the link's day, both floored to
 * local midnight) to its bucket label. `d===0` today, `d===1` yesterday,
 * `2..6` this week, `7+` earlier. A negative delta (a `createdAt` in the
 * future — clock skew) is treated as `Today` rather than falling through.
 */
function labelForDelta(d: number): DayBucketLabel {
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= 6) return 'This week';
  return 'Earlier';
}

/** Mirrors v3's `delBucket` exactly (`Silo-v3.html:843`) — same day/week cutoffs as `labelForDelta`, plus a `This month` band (7–29 days) before `Earlier` (30+). */
function labelForTrashDelta(d: number): TrashBucketLabel {
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= 6) return 'This week';
  if (d <= 29) return 'This month';
  return 'Earlier';
}

/**
 * Groups `links` (assumed `createdAt` DESC, per the API) into ordered
 * day-buckets by CALENDAR-DAY delta from `now` — never a rolling 7×86400s
 * window. Preserves each link's relative order within its bucket (a
 * first-match, stable partition); buckets with no items are dropped from the
 * result entirely. `now` is injectable so tests don't depend on wall-clock
 * time.
 */
export function bucketByDay(links: LinkJson[], now: Date = new Date()): DayBucket[] {
  const buckets = new Map<DayBucketLabel, LinkJson[]>();

  for (const link of links) {
    const label = labelForDelta(calendarDayDelta(new Date(link.createdAt), now));
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(link);
    } else {
      buckets.set(label, [link]);
    }
  }

  return DAY_BUCKET_LABELS.filter((label) => buckets.has(label)).map((label) => ({
    label,
    items: buckets.get(label) as LinkJson[],
  }));
}

/**
 * The Trash screen's day-grouping (plan 011, V3-5) — same calendar-day math
 * as `bucketByDay`, but keyed on `deletedAt` (when the link was trashed, not
 * when it was originally captured) and using `TRASH_BUCKET_LABELS`'s extra
 * `This month` band, matching v3's `trashGroups` exactly.
 */
export function bucketTrashByDay(links: TrashLinkJson[], now: Date = new Date()): TrashDayBucket[] {
  const buckets = new Map<TrashBucketLabel, TrashLinkJson[]>();

  for (const link of links) {
    const label = labelForTrashDelta(calendarDayDelta(new Date(link.deletedAt), now));
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(link);
    } else {
      buckets.set(label, [link]);
    }
  }

  return TRASH_BUCKET_LABELS.filter((label) => buckets.has(label)).map((label) => ({
    label,
    items: buckets.get(label) as TrashLinkJson[],
  }));
}

/**
 * The purge countdown shown per trash row (v3's `t.left`/`leftTitle`) — days
 * remaining until `deletedAt + purgeWindowDays` is reached, floored so
 * "27d left" means "still has 27 full days," not rounded up past the actual
 * purge moment. Never negative (a link whose window has technically elapsed
 * but hasn't been swept yet still reads `0d`, not a confusing negative
 * countdown).
 */
export function purgeCountdownDays(
  deletedAt: string,
  purgeWindowDays: number,
  now: Date = new Date(),
): number {
  const purgeAt = new Date(deletedAt).getTime() + purgeWindowDays * MS_PER_DAY;
  const remainingMs = purgeAt - now.getTime();
  return Math.max(0, Math.floor(remainingMs / MS_PER_DAY));
}
