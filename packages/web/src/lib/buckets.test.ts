import { describe, expect, it } from 'vitest';
import type { LinkJson } from '../api/types';
import { bucketByDay } from './buckets';

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

  it('buckets a link 7 calendar days back as Earlier', () => {
    const l = link({ id: '1', createdAt: at(2026, 5, 28) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'Earlier', items: [l] }]);
  });

  it('buckets a link 10 days back as Earlier', () => {
    const l = link({ id: '1', createdAt: at(2026, 5, 25) });
    expect(bucketByDay([l], NOW)).toEqual([{ label: 'Earlier', items: [l] }]);
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
    const earlierLink = link({ id: 'earlier', createdAt: at(2026, 5, 1) });
    // Input newest-first, as the API returns; Yesterday/This week have no items.
    const result = bucketByDay([todayLink, earlierLink], NOW);
    expect(result).toEqual([
      { label: 'Today', items: [todayLink] },
      { label: 'Earlier', items: [earlierLink] },
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
