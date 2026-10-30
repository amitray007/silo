import { expect, it } from 'vitest';
import { makeLink } from '../test/fixtures';
import { bucketFeedPosts } from './buckets';

it('uses published dates before capture dates, falls back for null, and groups local days', () => {
  const now = new Date(2026, 9, 29, 0, 5);
  const links = [
    makeLink({
      id: 'old',
      createdAt: now.toISOString(),
      publishedAt: new Date(2026, 9, 22).toISOString(),
    }),
    makeLink({ id: 'yesterday', publishedAt: new Date(2026, 9, 28, 23, 59).toISOString() }),
    makeLink({ id: 'six', publishedAt: new Date(2026, 9, 23).toISOString() }),
    makeLink({ id: 'fallback', publishedAt: null, createdAt: now.toISOString() }),
  ];
  expect(
    bucketFeedPosts(links, now).map((group) => ({
      label: group.label,
      ids: group.items.map((post) => post.id),
    })),
  ).toEqual([
    { label: 'Today', ids: ['fallback'] },
    { label: 'This week', ids: ['yesterday', 'six'] },
    { label: 'Earlier', ids: ['old'] },
  ]);
});
