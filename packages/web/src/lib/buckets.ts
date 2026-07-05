import type { LinkJson, TrashLinkJson } from '../api/types';

/**
 * The Library's day-group labels (plan 010; extended per a direct
 * user-feedback polish pass — "real day-group labels: don't stop at
 * 'Earlier'"). `Today`/`Yesterday`/`This week` stay fixed labels for recent
 * links; anything older is grouped by CALENDAR MONTH instead of dumping
 * everything into one "Earlier" bucket — the immediately-preceding calendar
 * month reads as `Last month`, and every month before that gets its own
 * `{Month} {Year}` label (`labelForMonth` below), most-recent-month-first.
 * `DayBucketLabel` is therefore a plain `string` (not a fixed literal union)
 * since the month-year labels are open-ended/data-dependent.
 */
type DayBucketLabel = string;

export type DayBucket = { label: DayBucketLabel; items: LinkJson[] };

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

/**
 * A stable sort/group key for "which calendar month" (`now`'s year × 12 +
 * month, so consecutive months are always adjacent integers regardless of
 * year boundaries — e.g. Dec 2025 → 24311, Jan 2026 → 24312).
 */
function monthKey(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/** `{Month} {Year}` for any month, e.g. `"July 2026"` — used for every calendar month beyond "Last month". */
function labelForMonth(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The bucket label for a link that has fallen out of `Today`/`Yesterday`/
 * `This week` (i.e. `calendarDayDelta >= 7`): the calendar month immediately
 * before `now`'s reads as `Last month`; every other (older, or — edge case —
 * the current, e.g. clock-skew-adjacent) month gets its own `{Month} {Year}`
 * label via `labelForMonth`.
 */
function labelForOlderMonth(date: Date, now: Date): string {
  const delta = monthKey(now) - monthKey(date);
  if (delta === 1) return 'Last month';
  return labelForMonth(date);
}

/**
 * The Trash screen's day-group labels (plan 011, V3-5) — v3's `delBucket`
 * (`Silo-v3.html:843`) uses a fixed `This month`/`Earlier` scheme (rather than
 * the Library's open-ended calendar-month labels above), so it's a DISTINCT,
 * fixed label set of its own.
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

/** v3's/plan 010's three fixed near-term labels, in display order — everything past `This week` falls to a calendar-month label instead (`labelForOlderMonth`). */
const RECENT_LABELS = ['Today', 'Yesterday', 'This week'] as const;

/**
 * Maps a calendar-day delta (today minus the link's day, both floored to
 * local midnight) to one of the three fixed near-term labels, or `null` once
 * the link is 7+ days old — the caller falls through to month-based grouping
 * for those. `d===0` today, `d===1` yesterday, `2..6` this week. A negative
 * delta (a `createdAt` in the future — clock skew) is treated as `Today`
 * rather than falling through.
 */
function labelForRecentDelta(d: number): (typeof RECENT_LABELS)[number] | null {
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= 6) return 'This week';
  return null;
}

/** Mirrors v3's `delBucket` exactly (`Silo-v3.html:843`) — same day/week cutoffs as `labelForRecentDelta`, plus a `This month` band (7–29 days) before `Earlier` (30+). */
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
 * window. `Today`/`Yesterday`/`This week` stay fixed near-term labels;
 * anything older is grouped by calendar month instead of one catch-all
 * "Earlier" bucket (per the user-feedback polish pass) — `Last month` for the
 * immediately-preceding calendar month, then a `{Month} {Year}` label per
 * month before that, ordered most-recent-month-first. Preserves each link's
 * relative order within its bucket (a first-match, stable partition);
 * buckets with no items are dropped from the result entirely. `now` is
 * injectable so tests don't depend on wall-clock time.
 */
export function bucketByDay(links: LinkJson[], now: Date = new Date()): DayBucket[] {
  const recentBuckets = new Map<(typeof RECENT_LABELS)[number], LinkJson[]>();
  // Keyed by `monthKey` (not the display label) so buckets sort correctly
  // across a year boundary without parsing the label back apart.
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

  // Month buckets sort newest-first by key (descending) — `links` is
  // createdAt-DESC overall, but that doesn't guarantee month-key order once
  // buckets are built from a Map, so this sorts explicitly rather than
  // relying on insertion order.
  const monthGroups = [...monthBuckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, group]) => group);

  return [...recentGroups, ...monthGroups];
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
