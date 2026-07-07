import { describe, expect, it } from 'vitest';
import { groupByDay } from './search-grouping.js';
import type { CapturedLink } from './types.js';

function link(id: string, createdAt: string): CapturedLink {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    description: null,
    siteName: null,
    sourceKind: 'link',
    sourceData: { kind: 'link' },
    captureStatus: 'full',
    notes: null,
    tags: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe('groupByDay', () => {
  const now = new Date('2026-07-07T12:00:00Z');

  it('groups into Today/Yesterday/This week/Earlier, in that order', () => {
    const links = [
      link('today', '2026-07-07T09:00:00Z'),
      link('yesterday', '2026-07-06T09:00:00Z'),
      link('thisweek', '2026-07-03T09:00:00Z'),
      link('earlier', '2026-06-01T09:00:00Z'),
    ];

    const sections = groupByDay(links, now);

    expect(sections.map((s) => s.title)).toEqual(['Today', 'Yesterday', 'This week', 'Earlier']);
    expect(sections[0]!.links).toHaveLength(1);
    expect(sections[0]!.links[0]!.id).toBe('today');
  });

  it('omits empty sections', () => {
    const links = [link('today', '2026-07-07T09:00:00Z')];
    const sections = groupByDay(links, now);
    expect(sections).toEqual([{ title: 'Today', links: [links[0]] }]);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupByDay([], now)).toEqual([]);
  });

  it('keeps multiple links from the same day in one section, preserving order', () => {
    const links = [link('a', '2026-07-07T09:00:00Z'), link('b', '2026-07-07T10:00:00Z')];
    const sections = groupByDay(links, now);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.links.map((l) => l.id)).toEqual(['a', 'b']);
  });
});
