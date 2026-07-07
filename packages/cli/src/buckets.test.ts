import { describe, expect, it } from 'vitest';
import { bucketByDay } from './buckets.js';
import type { LinkJson } from './types.js';

function linkAt(id: string, createdAt: string): LinkJson {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    description: null,
    imageUrl: null,
    siteName: null,
    extractedText: null,
    sourceKind: 'link',
    sourceData: { kind: 'link' },
    captureStatus: 'full',
    addedBy: 'user',
    notes: null,
    tags: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe('bucketByDay', () => {
  const now = new Date('2026-07-07T12:00:00.000Z');

  it('groups links into Today/Yesterday/This week', () => {
    const links = [
      linkAt('today', '2026-07-07T09:00:00.000Z'),
      linkAt('yesterday', '2026-07-06T09:00:00.000Z'),
      linkAt('this-week', '2026-07-03T09:00:00.000Z'),
    ];

    const buckets = bucketByDay(links, now);

    expect(buckets.map((b) => b.label)).toEqual(['Today', 'Yesterday', 'This week']);
    expect(buckets[0]?.items.map((l) => l.id)).toEqual(['today']);
  });

  it('groups a link from last month under "Last month"', () => {
    const links = [linkAt('old', '2026-06-01T09:00:00.000Z')];
    const buckets = bucketByDay(links, now);
    expect(buckets.map((b) => b.label)).toEqual(['Last month']);
  });

  it('labels older months as "{Month} {Year}"', () => {
    const links = [linkAt('older', '2026-01-15T09:00:00.000Z')];
    const buckets = bucketByDay(links, now);
    expect(buckets.map((b) => b.label)).toEqual(['January 2026']);
  });

  it('returns no buckets for an empty input', () => {
    expect(bucketByDay([], now)).toEqual([]);
  });

  it('sorts month buckets newest-first', () => {
    const links = [
      linkAt('jan', '2026-01-01T09:00:00.000Z'),
      linkAt('mar', '2026-03-01T09:00:00.000Z'),
    ];
    const buckets = bucketByDay(links, now);
    expect(buckets.map((b) => b.label)).toEqual(['March 2026', 'January 2026']);
  });

  it('treats a future createdAt (clock skew) as Today rather than throwing', () => {
    const links = [linkAt('future', '2026-07-08T09:00:00.000Z')];
    const buckets = bucketByDay(links, now);
    expect(buckets.map((b) => b.label)).toEqual(['Today']);
  });
});
