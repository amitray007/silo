import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { expectOk } from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `GET /api/tags` (plan 007, A2) — the
 * sidebar tag list with per-tag live-link counts.
 *
 * ONE `setupPgHarness` for the whole file (see `links.test.ts`'s doc comment
 * for why). The empty-list test runs first (Vitest runs `it`s within a file
 * in declaration order) so it can assert true emptiness before any other
 * test in this file seeds a tag.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

type TagsResponse = { tags: Array<{ name: string; count: number }> };

/** Fetches `GET /api/tags` and returns the entry + list-index for `name`, or `undefined`/`-1` if absent — the shared shape behind both ordering assertions in this file. */
async function findTag(
  app: Parameters<typeof expectOk>[0],
  name: string,
): Promise<{ entry: { name: string; count: number } | undefined; index: number }> {
  const body = await expectOk<TagsResponse>(app, '/api/tags');
  return {
    entry: body.tags.find((t) => t.name === name),
    index: body.tags.findIndex((t) => t.name === name),
  };
}

describeIfPg('GET /api/tags (integration)', () => {
  const harness = setupPgHarness('silo_api_tags_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  it('no tags at all -> { tags: [] } (runs first, before any seed)', async () => {
    const { app } = harness.mod();
    const body = await expectOk<{ tags: unknown[] }>(app, '/api/tags');
    expect(body.tags).toEqual([]);
  });

  it('returns correct per-tag live-link counts, ordered by count desc', async () => {
    const { core, app } = harness.mod();
    // 'popular-tag' on 2 live links, 'rare-tag' on 1.
    await core.createLink({
      url: 'https://example.com/tags-count-a',
      sourceKind: 'link',
      tags: ['popular-tag', 'rare-tag'],
    });
    await core.createLink({
      url: 'https://example.com/tags-count-b',
      sourceKind: 'link',
      tags: ['popular-tag'],
    });

    const popular = await findTag(app, 'popular-tag');
    const rare = await findTag(app, 'rare-tag');
    expect(popular.entry).toEqual({ name: 'popular-tag', count: 2 });
    expect(rare.entry).toEqual({ name: 'rare-tag', count: 1 });
    expect(popular.index).toBeLessThan(rare.index);
  });

  it('a tag whose only links are trashed still appears at count 0', async () => {
    const { core, app } = harness.mod();
    const link = await core.createLink({
      url: 'https://example.com/tags-trashed-only',
      sourceKind: 'link',
      tags: ['trashed-only-tag'],
    });
    await core.softDelete(link.id);

    // The tag row persists; its live count is 0 (see core.listTagsWithCounts —
    // left-joined so an empty/all-trashed tag surfaces rather than vanishing,
    // so the '+ new tag' flow's empty tags are visible + assignable).
    const { entry } = await findTag(app, 'trashed-only-tag');
    expect(entry).toEqual({ name: 'trashed-only-tag', count: 0 });
  });

  it('overall ordering across many tags is count desc then name asc', async () => {
    const { core, app } = harness.mod();
    await core.createLink({
      url: 'https://example.com/tags-order-1',
      sourceKind: 'link',
      tags: ['zzz-tag', 'aaa-tag'],
    });
    await core.createLink({
      url: 'https://example.com/tags-order-2',
      sourceKind: 'link',
      tags: ['zzz-tag'],
    });

    const zzz = await findTag(app, 'zzz-tag');
    const aaa = await findTag(app, 'aaa-tag');
    expect(zzz.entry?.count).toBe(2);
    expect(aaa.entry?.count).toBe(1);
    // Higher count sorts first, regardless of alphabetical name.
    expect(zzz.index).toBeLessThan(aaa.index);
  });
});
