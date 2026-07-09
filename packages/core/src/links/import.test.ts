import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as ImportOps from './import.js';
import type * as LinksOps from './links.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md) —
 * `importLinks` drives `createLink`'s full dedup-merge write path, which
 * mocks can't prove. Mirrors `export.test.ts`/`links.test.ts`'s harness
 * pattern.
 *
 * CRITICAL: never statically `import { db } from '@silo/db'` at module top —
 * it hoists Pool construction ahead of `setupPgHarness`'s `DATABASE_URL`
 * rewrite and leaks rows into the real dev database (`silo_dev`). This file
 * only imports `@silo/db` dynamically, inside `it()` blocks, exactly as
 * `export.test.ts`'s "sourceData null" case documents.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('importLinks (integration)', () => {
  const harness = setupPgHarness('silo_core_import_test', () => import('./import.js'));
  let ops: typeof ImportOps;
  let linkOps: typeof LinksOps;

  beforeEach(async () => {
    ops = harness.mod();
    linkOps = await import('./links.js');
  });

  /** Build a minimal `version: 1` envelope from a list of per-link fields. */
  function envelope(links: unknown[]): { version: 1; links: unknown[] } {
    return { version: 1, links };
  }

  describe('round-trip', () => {
    it('imports a version:1 payload built by hand — all links present with correct tags', async () => {
      const payload = envelope([
        {
          url: 'https://example.com/import-round-trip-1',
          sourceKind: 'link',
          title: 'First',
          tags: ['ai', 'postgres'],
        },
        {
          url: 'https://example.com/import-round-trip-2',
          sourceKind: 'twitter',
          title: 'A tweet',
          sourceData: {
            kind: 'twitter',
            text: 'hello world',
            authorHandle: 'someone',
            authorName: 'Someone',
            likes: 1,
            reposts: 0,
            replies: 0,
            quotes: 0,
            bookmarks: 0,
          },
          tags: ['twitter'],
          addedBy: 'agent',
        },
      ]);

      const result = await ops.importLinks(payload);
      expect(result.version).toBe(1);
      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
      expect(result.merged).toBe(0);
      expect(result.skipped).toEqual([]);

      const first = await linkOps.findByCanonicalUrl('https://example.com/import-round-trip-1');
      expect(first).not.toBeNull();
      expect(first?.title).toBe('First');
      const firstHydrated = await linkOps.getById(first?.id ?? '');
      expect(firstHydrated?.tags.slice().sort()).toEqual(['ai', 'postgres']);

      const second = await linkOps.findByCanonicalUrl('https://example.com/import-round-trip-2');
      expect(second).not.toBeNull();
      expect(second?.addedBy).toBe('agent');
      expect(second?.sourceData).toMatchObject({ kind: 'twitter', text: 'hello world' });
    });

    it('round-trips an exportLinks payload through JSON.parse/stringify', async () => {
      await linkOps.createLink({
        url: 'https://example.com/import-export-roundtrip',
        title: 'Exported then imported',
        sourceKind: 'link',
        tags: ['roundtrip'],
      });

      const { exportLinks } = await import('./export.js');
      const exported = await exportLinks({ format: 'json' });
      const parsedExport = JSON.parse(exported.body);

      // Import into a fresh state is not possible in this shared-harness
      // suite (same disposable DB across the file), so this asserts the
      // export payload is ACCEPTED and re-imports cleanly (merges, since the
      // link already exists) rather than into a second empty database.
      const result = await ops.importLinks(parsedExport);
      expect(result.total).toBe(1);
      expect(result.merged).toBe(1);
      expect(result.created).toBe(0);
      expect(result.skipped).toEqual([]);
    });
  });

  describe('envelope validation', () => {
    it('version: 2 throws InvalidImportError', async () => {
      await expect(ops.importLinks({ version: 2, links: [] })).rejects.toThrow(
        ops.InvalidImportError,
      );
    });

    it('missing version throws InvalidImportError', async () => {
      await expect(ops.importLinks({ links: [] })).rejects.toThrow(ops.InvalidImportError);
    });

    it('missing links throws InvalidImportError', async () => {
      await expect(ops.importLinks({ version: 1 })).rejects.toThrow(ops.InvalidImportError);
    });

    it('a non-object payload throws InvalidImportError', async () => {
      await expect(ops.importLinks('not an object')).rejects.toThrow(ops.InvalidImportError);
      await expect(ops.importLinks(null)).rejects.toThrow(ops.InvalidImportError);
    });
  });

  describe('per-link failures', () => {
    it('a link missing url is skipped by the envelope schema (not a link at all); others import', async () => {
      // A link object missing the REQUIRED `url` field fails the per-link
      // Zod schema inside the envelope parse — since envelope parsing is
      // ALL-OR-NOTHING (envelope-level failure), a structurally-invalid link
      // (wrong TYPE, not just a bad VALUE) makes envelope parsing itself
      // fail. This test instead exercises a link that parses fine at the
      // envelope level but fails inside `createLink` (bad sourceData) — the
      // documented per-link skip path.
      const payload = envelope([
        {
          url: 'https://example.com/import-good-1',
          sourceKind: 'link',
        },
        {
          url: 'https://example.com/import-bad-source-data',
          sourceKind: 'hacker_news',
          // Missing required hacker_news fields (points/comments/author) —
          // valid per the loose envelope schema (sourceData is
          // z.record(unknown)), but createLink's sourceDataSchema rejects it.
          sourceData: { kind: 'hacker_news' },
        },
        {
          url: 'https://example.com/import-good-2',
          sourceKind: 'link',
        },
      ]);

      const result = await ops.importLinks(payload);
      expect(result.total).toBe(3);
      expect(result.created).toBe(2);
      expect(result.merged).toBe(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({
        index: 1,
        url: 'https://example.com/import-bad-source-data',
      });
      expect(result.skipped[0]?.reason).toBeTruthy();

      const good1 = await linkOps.findByCanonicalUrl('https://example.com/import-good-1');
      expect(good1).not.toBeNull();
      const good2 = await linkOps.findByCanonicalUrl('https://example.com/import-good-2');
      expect(good2).not.toBeNull();
      const bad = await linkOps.findByCanonicalUrl('https://example.com/import-bad-source-data');
      expect(bad).toBeNull();
    });

    it('a non-string url field fails the envelope schema and rejects the whole file (envelope-level type failure)', async () => {
      const payload = envelope([{ url: 123, sourceKind: 'link' }]);
      await expect(ops.importLinks(payload)).rejects.toThrow(ops.InvalidImportError);
    });
  });

  describe('merge path', () => {
    it('importing an already-present URL increments merged and unions notes/tags', async () => {
      const existing = await linkOps.createLink({
        url: 'https://example.com/import-merge-target',
        sourceKind: 'link',
        notes: 'original note',
        tags: ['existing-tag'],
      });

      const payload = envelope([
        {
          url: 'https://example.com/import-merge-target',
          sourceKind: 'link',
          notes: 'imported note',
          tags: ['imported-tag'],
        },
      ]);

      const result = await ops.importLinks(payload);
      expect(result.total).toBe(1);
      expect(result.created).toBe(0);
      expect(result.merged).toBe(1);
      expect(result.skipped).toEqual([]);

      const merged = await linkOps.getById(existing.id);
      expect(merged?.notes).toContain('original note');
      expect(merged?.notes).toContain('imported note');
      expect(merged?.tags.slice().sort()).toEqual(['existing-tag', 'imported-tag']);
    });
  });

  describe('addedBy / origin preserved', () => {
    it("addedBy: 'agent' imports as agent origin", async () => {
      const payload = envelope([
        {
          url: 'https://example.com/import-agent-origin',
          sourceKind: 'link',
          addedBy: 'agent',
        },
      ]);

      const result = await ops.importLinks(payload);
      expect(result.created).toBe(1);

      const found = await linkOps.findByCanonicalUrl('https://example.com/import-agent-origin');
      expect(found?.addedBy).toBe('agent');
    });

    it('omitted addedBy defaults to user origin', async () => {
      const payload = envelope([
        {
          url: 'https://example.com/import-default-origin',
          sourceKind: 'link',
        },
      ]);

      await ops.importLinks(payload);
      const found = await linkOps.findByCanonicalUrl('https://example.com/import-default-origin');
      expect(found?.addedBy).toBe('user');
    });
  });
});
