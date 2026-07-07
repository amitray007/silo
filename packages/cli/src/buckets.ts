import type { LinkJson } from './types.js';

/**
 * The CLI's own copy of `packages/web/src/lib/buckets.ts`'s `bucketByDay` —
 * mirrors the web UI's day-grouping (`Today`/`Yesterday`/`This week`, then
 * calendar-month labels) so `silo list`'s terminal output reads the same as
 * the Library view. Deliberately duplicated rather than imported: the CLI
 * doesn't depend on `@silo/web` (adapters don't share code across the
 * workspace boundary — `docs/rules/architecture.md`), and this is a small,
 * self-contained pure function, not worth a shared package for one slice.
 */
export type DayBucket = { label: string; items: LinkJson[] };

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function monthKey(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function labelForMonth(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function labelForOlderMonth(date: Date, now: Date): string {
  const delta = monthKey(now) - monthKey(date);
  if (delta === 1) return 'Last month';
  return labelForMonth(date);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function calendarDayDelta(date: Date, now: Date): number {
  const today = startOfLocalDay(now);
  const day = startOfLocalDay(date);
  return Math.round((today.getTime() - day.getTime()) / MS_PER_DAY);
}

const RECENT_LABELS = ['Today', 'Yesterday', 'This week'] as const;

function labelForRecentDelta(d: number): (typeof RECENT_LABELS)[number] | null {
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= 6) return 'This week';
  return null;
}

/**
 * Groups `links` (assumed `createdAt` DESC, per the API) into ordered
 * day-buckets, mirroring `packages/web/src/lib/buckets.ts`'s `bucketByDay`
 * exactly (same near-term labels, same calendar-month fallback for older
 * links). `now` is injectable so tests don't depend on wall-clock time.
 */
export function bucketByDay(links: LinkJson[], now: Date = new Date()): DayBucket[] {
  const recentBuckets = new Map<(typeof RECENT_LABELS)[number], LinkJson[]>();
  const monthBuckets = new Map<number, { label: string; items: LinkJson[] }>();

  for (const link of links) {
    const createdAt = new Date(link.createdAt);
    const recentLabel = labelForRecentDelta(calendarDayDelta(createdAt, now));

    if (recentLabel) {
      const bucket = recentBuckets.get(recentLabel);
      if (bucket) bucket.push(link);
      else recentBuckets.set(recentLabel, [link]);
      continue;
    }

    const key = monthKey(createdAt);
    const bucket = monthBuckets.get(key);
    if (bucket) {
      bucket.items.push(link);
    } else {
      monthBuckets.set(key, { label: labelForOlderMonth(createdAt, now), items: [link] });
    }
  }

  const recentGroups = RECENT_LABELS.filter((label) => recentBuckets.has(label)).map((label) => ({
    label,
    items: recentBuckets.get(label) as LinkJson[],
  }));

  const monthGroups = [...monthBuckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, group]) => group);

  return [...recentGroups, ...monthGroups];
}
