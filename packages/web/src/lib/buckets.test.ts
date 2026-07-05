import { describe, expect, it } from 'vitest';
import type { LinkJson, TrashLinkJson } from '../api/types';
import { bucketByDay, bucketTrashByDay, purgeCountdownDays } from './buckets';

/** A `now` fixed well inside a day (not near midnight) so day-delta math in the fixtures below is unambiguous. */
const NOW = new Date(2026, 6, 5, 12, 0, 0); // 2026-07-05 noon, local time

function link(overrides: Partial<LinkJson> & { id: string; createdAt: string }): LinkJson {
  return {
    url: 'https://example.com',
    title: 'Example',
    description: null,
    imageUrl: null,
    siteName: null,
    extractedText: null,
    sourceKind: 'link',
    captureStatus: 'full',
    addedBy: 'user',
    notes: null,
    tags: [],
    updatedAt: overrides.createdAt,
    ...overrides,
  };
}

/** Builds an ISO `createdAt` for a local date/time, so fixtures read naturally. */
function at(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m, d, h).toISOString();
}

describe('bucketByDay', () => {
  it('buckets a same-calendar-day link as Today', () => {
    const l = link({ id: '1', createdAt: at(2026, 6, 5, 8) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'Today', items: [l] }]);
  });

  it('buckets a link from the previous calendar day as Yesterday', () => {
    const l = link({ id: '1', createdAt: at(2026, 6, 4, 23) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'Yesterday', items: [l] }]);
  });

  it('buckets a link 3 calendar days back as This week', () => {
    const l = link({ id: '1', createdAt: at(2026, 6, 2) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'This week', items: [l] }]);
  });

  it('buckets a link 6 calendar days back as the last day of This week', () => {
    const l = link({ id: '1', createdAt: at(2026, 5, 29) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'This week', items: [l] }]);
  });

  it('buckets a link 7 calendar days back, in the previous calendar month, as Last month', () => {
    // NOW is 2026-07-05; 2026-06-28 is in June — the calendar month right before July.
    const l = link({ id: '1', createdAt: at(2026, 5, 28) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'Last month', items: [l] }]);
  });

  it('buckets a link 10 days back, same previous calendar month, as Last month', () => {
    const l = link({ id: '1', createdAt: at(2026, 5, 25) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'Last month', items: [l] }]);
  });

  it('buckets a link two calendar months back with a real "{Month} {Year}" label', () => {
    // NOW is July 2026; May 2026 is two months back — not "Last month".
    const l = link({ id: '1', createdAt: at(2026, 4, 15) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'May 2026', items: [l] }]);
  });

  it('labels a calendar month from a prior YEAR with the year included', () => {
    const l = link({ id: '1', createdAt: at(2025, 6, 15) }); // July 2025 — a year back
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'July 2025', items: [l] }]);
  });

  it('groups older links by calendar month (not by a rolling 30-day window), most-recent-month-first', () => {
    const juneLink = link({ id: 'june', createdAt: at(2026, 5, 20) });
    const mayLink = link({ id: 'may', createdAt: at(2026, 4, 10) });
    const aprilLink = link({ id: 'april', createdAt: at(2026, 3, 1) });
    // Deliberately out of chronological order in the input to prove the
    // month-key sort (not insertion order) drives the result.
    const result = bucketByDay([mayLink, juneLink, aprilLink], NOW);
    expect(result).toEqual([
      { label: 'Last month', items: [juneLink] },
      { label: 'May 2026', items: [mayLink] },
      { label: 'April 2026', items: [aprilLink] },
    ]);
  });

  it('keeps multiple links from the same older calendar month in one bucket, in relative order', () => {
    const first = link({ id: 'first', createdAt: at(2026, 5, 3) });
    const second = link({ id: 'second', createdAt: at(2026, 5, 22) });
    expect(bucketByDay([first, second], NOW)).toEqual([
      { label: 'Last month', items: [first, second] },
    ]);
  });

  it('is a calendar-day boundary, not a rolling 24h window: 11pm yesterday and 1am today are 1 calendar day apart', () => {
    const late = link({ id: 'late-yesterday', createdAt: at(2026, 6, 4, 23) });
    const early = link({ id: 'early-today', createdAt: at(2026, 6, 5, 1) });
    const result = bucketByDay([early, late], NOW);
    expect(result).toEqual([
      { label: 'Today', items: [early] },
      { label: 'Yesterday', items: [late] },
    ]);
  });

  it('a link exactly at the local-midnight boundary of today falls in Today, not Yesterday', () => {
    const atMidnight = link({
      id: 'midnight',
      createdAt: new Date(2026, 6, 5, 0, 0, 0, 0).toISOString(),
    });
    expect(bucketByDay([atMidnight], NOW)).toEqual([{ label: 'Today', items: [atMidnight] }]);
  });

  it('drops empty groups and preserves label order across non-adjacent buckets', () => {
    const todayLink = link({ id: 'today', createdAt: at(2026, 6, 5) });
    const olderLink = link({ id: 'older', createdAt: at(2026, 4, 1) }); // May 2026 — two months back
    // Input newest-first, as the API returns; Yesterday/This week have no items.
    const result = bucketByDay([todayLink, olderLink], NOW);
    expect(result).toEqual([
      { label: 'Today', items: [todayLink] },
      { label: 'May 2026', items: [olderLink] },
    ]);
  });

  it('preserves relative order of multiple links within the same bucket', () => {
    const first = link({ id: 'first', createdAt: at(2026, 6, 5, 9) });
    const second = link({ id: 'second', createdAt: at(2026, 6, 5, 14) });
    expect(bucketByDay([first, second], NOW)).toEqual([{ label: 'Today', items: [first, second] }]);
  });

  it('returns an empty array for no links', () => {
    expect(bucketByDay([], NOW)).toEqual([]);
  });
});

/** A `TrashLinkJson` fixture keyed on `deletedAt` (not `createdAt`) — `bucketTrashByDay` groups by when a link was TRASHED. */
function trashLink(
  overrides: Partial<TrashLinkJson> & { id: string; deletedAt: string },
): TrashLinkJson {
  return {
    url: 'https://example.com',
    title: 'Example',
    description: null,
    imageUrl: null,
    siteName: null,
    extractedText: null,
    sourceKind: 'link',
    captureStatus: 'full',
    addedBy: 'user',
    notes: null,
    tags: [],
    createdAt: overrides.deletedAt,
    updatedAt: overrides.deletedAt,
    ...overrides,
  };
}

describe('bucketTrashByDay', () => {
  it('groups by deletedAt, not createdAt', () => {
    const l = trashLink({
      id: '1',
      createdAt: at(2026, 5, 1), // captured long ago
      deletedAt: at(2026, 6, 5, 8), // trashed today
    });
    expect(bucketTrashByDay([l], NOW)).toEqual([{ label: 'Today', items: [l] }]);
  });

  it('has the extra "This month" band (7-29 days) the Library grouping does not', () => {
    const l = trashLink({ id: '1', deletedAt: at(2026, 5, 20) }); // 16 days back
    expect(bucketTrashByDay([l], NOW)).toEqual([{ label: 'This month', items: [l] }]);
  });

  it('falls to Earlier at 30+ days back', () => {
    const l = trashLink({ id: '1', deletedAt: at(2026, 5, 1) }); // 35 days back
    expect(bucketTrashByDay([l], NOW)).toEqual([{ label: 'Earlier', items: [l] }]);
  });

  it('the last day of This month (29 days back) still buckets as This month, not Earlier', () => {
    const l = trashLink({ id: '1', deletedAt: at(2026, 5, 7) }); // 29 days back
    expect(bucketTrashByDay([l], NOW)).toEqual([{ label: 'This month', items: [l] }]);
  });

  it('drops empty groups and preserves label order across non-adjacent buckets', () => {
    const todayLink = trashLink({ id: 'today', deletedAt: at(2026, 6, 5) });
    const monthLink = trashLink({ id: 'month', deletedAt: at(2026, 5, 20) });
    expect(bucketTrashByDay([todayLink, monthLink], NOW)).toEqual([
      { label: 'Today', items: [todayLink] },
      { label: 'This month', items: [monthLink] },
    ]);
  });

  it('returns an empty array for no trashed links', () => {
    expect(bucketTrashByDay([], NOW)).toEqual([]);
  });
});

describe('purgeCountdownDays', () => {
  it('counts down from a 30-day purge window', () => {
    const deletedAt = at(2026, 6, 1); // 4 days before NOW
    expect(purgeCountdownDays(deletedAt, 30, NOW)).toBe(26);
  });

  it('never goes negative once the purge window has technically elapsed', () => {
    const deletedAt = at(2026, 5, 1); // 35 days before NOW
    expect(purgeCountdownDays(deletedAt, 30, NOW)).toBe(0);
  });

  it('is exactly the full window on the moment of deletion', () => {
    // `at()` fixes noon; NOW is also noon on 2026-07-05, so `deletedAt` right
    // now is exactly 0 elapsed days.
    expect(purgeCountdownDays(NOW.toISOString(), 30, NOW)).toBe(30);
  });
});
