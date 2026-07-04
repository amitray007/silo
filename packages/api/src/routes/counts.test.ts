import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `GET /api/counts` (plan 007, A2) — the
 * sidebar's live/trash counts plus the read-only purge window.
 *
 * ONE `setupPgHarness` for the whole file (see `links.test.ts`'s doc comment
 * for why). The fresh-database assertion runs first (Vitest runs `it`s
 * within a file in declaration order); every subsequent test asserts a DELTA
 * against a freshly-fetched baseline rather than an absolute number, since
 * later tests legitimately leave links behind for earlier ones to build on.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('GET /api/counts (integration)', () => {
  const harness = setupPgHarness('silo_api_counts_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  async function getCounts(): Promise<{ live: number; trash: number; purgeWindowDays: number }> {
    const { app } = harness.mod();
    const res = await app.request('/api/counts');
    expect(res.status).toBe(200);
    return (await res.json()) as { live: number; trash: number; purgeWindowDays: number };
  }

  it('starts at { live: 0, trash: 0, purgeWindowDays } in a fresh database (runs first)', async () => {
    const { core } = harness.mod();
    const body = await getCounts();
    // Assert against core's own constant rather than a hardcoded 30, so this
    // test can't silently drift if PURGE_WINDOW_DAYS ever changes.
    expect(body).toEqual({ live: 0, trash: 0, purgeWindowDays: core.PURGE_WINDOW_DAYS });
  });

  it('reflects a create — live increments by exactly 1, trash unchanged', async () => {
    const { core } = harness.mod();
    const before = await getCounts();
    await core.createLink({ url: 'https://example.com/counts-create', sourceKind: 'link' });
    const after = await getCounts();
    expect(after.live).toBe(before.live + 1);
    expect(after.trash).toBe(before.trash);
  });

  it('reflects a trash (softDelete) — live decrements by 1, trash increments by 1', async () => {
    const { core } = harness.mod();
    const link = await core.createLink({
      url: 'https://example.com/counts-trash',
      sourceKind: 'link',
    });
    const before = await getCounts();
    await core.softDelete(link.id);
    const after = await getCounts();
    expect(after.live).toBe(before.live - 1);
    expect(after.trash).toBe(before.trash + 1);
  });

  it('reflects a restore — trash decrements by 1, live increments by 1', async () => {
    const { core } = harness.mod();
    const link = await core.createLink({
      url: 'https://example.com/counts-restore',
      sourceKind: 'link',
    });
    await core.softDelete(link.id);
    const before = await getCounts();
    await core.restore(link.id);
    const after = await getCounts();
    expect(after.trash).toBe(before.trash - 1);
    expect(after.live).toBe(before.live + 1);
  });

  it('purgeWindowDays reflects core.PURGE_WINDOW_DAYS regardless of data state', async () => {
    const { core } = harness.mod();
    const { purgeWindowDays } = await getCounts();
    expect(purgeWindowDays).toBe(core.PURGE_WINDOW_DAYS);
  });
});
