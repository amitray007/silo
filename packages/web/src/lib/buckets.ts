import type { LinkJson } from '../api/types';

/** The Library's day-group labels, in display order (plan 010). */
const DAY_BUCKET_LABELS = ['Today', 'Yesterday', 'This week', 'Earlier'] as const;

type DayBucketLabel = (typeof DAY_BUCKET_LABELS)[number];

export type DayBucket = { label: DayBucketLabel; items: LinkJson[] };

/** Floors a `Date` to LOCAL midnight (mirrors the prototype's `delBucket` day-math — a calendar-day boundary, not a rolling 24h window). */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/**
 * Groups `links` (assumed `createdAt` DESC, per the API) into ordered
 * day-buckets by CALENDAR-DAY delta from `now` — never a rolling 7×86400s
 * window. Preserves each link's relative order within its bucket (a
 * first-match, stable partition); buckets with no items are dropped from the
 * result entirely. `now` is injectable so tests don't depend on wall-clock
 * time.
 */
export function bucketByDay(links: LinkJson[], now: Date = new Date()): DayBucket[] {
  const today = startOfLocalDay(now);
  const buckets = new Map<DayBucketLabel, LinkJson[]>();

  for (const link of links) {
    const linkDay = startOfLocalDay(new Date(link.createdAt));
    const deltaDays = Math.round((today.getTime() - linkDay.getTime()) / MS_PER_DAY);
    const label = labelForDelta(deltaDays);
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
