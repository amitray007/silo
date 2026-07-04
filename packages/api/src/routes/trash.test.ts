import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { expect400, expectOk, walkAllPages } from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `GET /api/trash` (plan 007, A2), driven
 * via Hono's `app.request(...)` against a real Postgres — the Trash screen's
 * whole data surface.
 *
 * ONE `setupPgHarness` for the whole file (see `links.test.ts`'s doc comment
 * for why: `@silo/db`'s pool is a module-load-time singleton the harness's
 * `afterAll` permanently closes, so a second harness in the same file/module
 * graph can't reopen it). The first test relies on running against an
 * otherwise-untouched database to prove true emptiness — Vitest runs `it`s
 * within one file in declaration order, so it's declared first.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('GET /api/trash (integration)', () => {
  const harness = setupPgHarness('silo_api_trash_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  it('empty trash returns { links: [] }, not an error (runs first, before any seed)', async () => {
    const { app } = harness.mod();
    const body = await expectOk<{ links: unknown[] }>(app, '/api/trash');
    expect(body.links).toEqual([]);
  });

  it('returns only trashed links, not live ones', async () => {
    const { core, app } = harness.mod();
    const live = await core.createLink({
      url: 'https://example.com/trash-list-live',
      sourceKind: 'link',
    });
    const trashed = await core.createLink({
      url: 'https://example.com/trash-list-trashed',
      sourceKind: 'link',
    });
    await core.softDelete(trashed.id);

    const body = await expectOk<{ links: Array<{ id: string }> }>(app, '/api/trash');
    const ids = body.links.map((l) => l.id);
    expect(ids).toContain(trashed.id);
    expect(ids).not.toContain(live.id);
  });

  it('each trashed link carries deletedAt (ISO string) and the whitelisted shape', async () => {
    const { core, app } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.com/trash-deletedat-check',
      sourceKind: 'link',
    });
    await core.softDelete(created.id);

    const body = await expectOk<{ links: Array<Record<string, unknown>> }>(app, '/api/trash');
    const link = body.links.find((l) => l.id === created.id);
    expect(link).toBeDefined();
    if (!link) return;
    expect(typeof link.deletedAt).toBe('string');
    expect(Number.isNaN(new Date(link.deletedAt as string).getTime())).toBe(false);
    expect(Object.hasOwn(link, 'searchVector')).toBe(false);
    expect(Object.hasOwn(link, 'canonicalUrl')).toBe(false);
    expect(Object.hasOwn(link, 'sourceData')).toBe(false);
  });

  it('paginates trashed links (limit + nextCursor round-trip, no dup/gap)', async () => {
    const { core, app } = harness.mod();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const link = await core.createLink({
        url: `https://example.com/trash-pagination-${i}`,
        sourceKind: 'link',
      });
      await core.softDelete(link.id);
      ids.push(link.id);
    }

    const seen = await walkAllPages(app, '/api/trash');
    for (const id of ids) {
      expect(seen).toContain(id);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('malformed cursor -> 400 invalid_cursor', async () => {
    const { app } = harness.mod();
    await expect400(app, '/api/trash?cursor=not-a-valid-cursor!!!', 'invalid_cursor');
  });

  it('a list-cursor (wrong kind) handed to /api/trash -> 400 invalid_cursor', async () => {
    const { core, app } = harness.mod();
    for (let i = 0; i < 2; i++) {
      await core.createLink({
        url: `https://example.com/trash-wrong-cursor-kind-${i}`,
        sourceKind: 'link',
      });
    }
    const listBody = await expectOk<{ nextCursor?: string }>(app, '/api/links?limit=1');
    expect(listBody.nextCursor).toBeDefined();
    if (!listBody.nextCursor) return;

    await expect400(
      app,
      `/api/trash?cursor=${encodeURIComponent(listBody.nextCursor)}`,
      'invalid_cursor',
    );
  });
});
