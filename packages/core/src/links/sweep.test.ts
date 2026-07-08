import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as LinksOps from './links.js';
import type * as SweepOps from './sweep.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md):
 * the staleness cutoff, live-scoping, and bounded LIMIT/ordering are all
 * database-level behaviors mocks can't prove.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('findStrandedEnriching (integration)', () => {
  const harness = setupPgHarness('silo_core_sweep_test', async () => ({
    links: await import('./links.js'),
    sweep: await import('./sweep.js'),
  }));
  let linksOps: typeof LinksOps;
  let sweepOps: typeof SweepOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    linksOps = harness.mod().links;
    sweepOps = harness.mod().sweep;
    rawDb = harness.rawDb();
  });

  const MINUTE_MS = 60 * 1000;

  /** Creates a live link and force-sets its capture_status + updated_at directly, bypassing the ORM's `$onUpdate`. */
  async function insertEnrichingLink(
    canonicalUrl: string,
    updatedAt: Date,
    overrides: { deletedAt?: Date; captureStatus?: string; enrichAttempts?: number } = {},
  ): Promise<{ id: string }> {
    const created = await linksOps.createLink({ url: canonicalUrl, sourceKind: 'link' });
    await rawDb.execute(sql`
      update links
      set capture_status = ${overrides.captureStatus ?? 'enriching'},
          updated_at = ${updatedAt.toISOString()}::timestamptz,
          deleted_at = ${overrides.deletedAt ? overrides.deletedAt.toISOString() : null}::timestamptz,
          enrich_attempts = ${overrides.enrichAttempts ?? 0}
      where id = ${created.id}
    `);
    return created;
  }

  describe('happy path', () => {
    it('returns a link stranded past the stale window; a recently-updated enriching link is excluded', async () => {
      const stale = await insertEnrichingLink(
        'https://example.com/stale-enriching',
        new Date(Date.now() - 30 * MINUTE_MS),
      );
      const fresh = await insertEnrichingLink(
        'https://example.com/fresh-enriching',
        new Date(Date.now() - 1 * MINUTE_MS),
      );

      const result = await sweepOps.findStrandedEnriching({ staleMinutes: 15 });

      const ids = result.map((r) => r.id);
      expect(ids).toContain(stale.id);
      expect(ids).not.toContain(fresh.id);
      void fresh;
    });

    it('excludes links not at capture_status=enriching (full/partial/bare)', async () => {
      const full = await insertEnrichingLink(
        'https://example.com/full-status',
        new Date(Date.now() - 30 * MINUTE_MS),
        { captureStatus: 'full' },
      );
      const partial = await insertEnrichingLink(
        'https://example.com/partial-status',
        new Date(Date.now() - 30 * MINUTE_MS),
        { captureStatus: 'partial' },
      );

      const result = await sweepOps.findStrandedEnriching({ staleMinutes: 15 });

      const ids = result.map((r) => r.id);
      expect(ids).not.toContain(full.id);
      expect(ids).not.toContain(partial.id);
    });
  });

  describe('attempt cap', () => {
    it('excludes a row whose enrich_attempts has reached ENRICH_ATTEMPT_CAP; a row below the cap is still returned', async () => {
      const { ENRICH_ATTEMPT_CAP } = await import('./enrichment.js');
      const capped = await insertEnrichingLink(
        'https://example.com/capped-enriching',
        new Date(Date.now() - 30 * MINUTE_MS),
        { enrichAttempts: ENRICH_ATTEMPT_CAP },
      );
      const belowCap = await insertEnrichingLink(
        'https://example.com/below-cap-enriching',
        new Date(Date.now() - 30 * MINUTE_MS),
        { enrichAttempts: ENRICH_ATTEMPT_CAP - 1 },
      );

      const result = await sweepOps.findStrandedEnriching({ staleMinutes: 15 });

      const ids = result.map((r) => r.id);
      expect(ids).not.toContain(capped.id);
      expect(ids).toContain(belowCap.id);
    });
  });

  describe('live-scoping', () => {
    it('excludes a trashed link stuck at enriching, even if stale', async () => {
      const trashedStale = await insertEnrichingLink(
        'https://example.com/trashed-stale-enriching',
        new Date(Date.now() - 30 * MINUTE_MS),
        { deletedAt: new Date() },
      );

      const result = await sweepOps.findStrandedEnriching({ staleMinutes: 15 });

      expect(result.map((r) => r.id)).not.toContain(trashedStale.id);
    });
  });

  describe('bounded + ordering', () => {
    it('respects the limit and orders oldest-updated-first', async () => {
      const older = await insertEnrichingLink(
        'https://example.com/oldest-stranded',
        new Date(Date.now() - 60 * MINUTE_MS),
      );
      const middle = await insertEnrichingLink(
        'https://example.com/middle-stranded',
        new Date(Date.now() - 45 * MINUTE_MS),
      );
      const newer = await insertEnrichingLink(
        'https://example.com/newer-stranded',
        new Date(Date.now() - 30 * MINUTE_MS),
      );

      const result = await sweepOps.findStrandedEnriching({ staleMinutes: 15, limit: 2 });

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe(older.id);
      expect(result[1]?.id).toBe(middle.id);
      expect(result.map((r) => r.id)).not.toContain(newer.id);
    });
  });

  describe('edge cases', () => {
    it('returns an empty array when nothing is stranded', async () => {
      const result = await sweepOps.findStrandedEnriching();
      expect(result).toEqual([]);
    });

    it('rejects a non-positive staleMinutes', async () => {
      await expect(sweepOps.findStrandedEnriching({ staleMinutes: 0 })).rejects.toThrow();
      await expect(sweepOps.findStrandedEnriching({ staleMinutes: -5 })).rejects.toThrow();
    });

    it('rejects a non-positive or non-integer limit', async () => {
      await expect(sweepOps.findStrandedEnriching({ limit: 0 })).rejects.toThrow();
      await expect(sweepOps.findStrandedEnriching({ limit: 1.5 })).rejects.toThrow();
    });
  });
});
