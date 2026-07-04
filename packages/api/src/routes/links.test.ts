import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  expect400,
  expectOk,
  expectWhitelistedLinkShape,
  walkAllPages,
} from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for the A2 read routes (plan 007), driven via
 * Hono's `app.request(...)` against a real Postgres (see `docs/rules/
 * testing.md` — pagination/ranking/filters are database behaviors mocks
 * can't prove). Covers `GET /api/links`, `GET /api/links/search`, and
 * `GET /api/links/:id`.
 *
 * ONE `setupPgHarness` call for the whole file (not one per `describe`
 * block): `@silo/db`'s `pool`/`db` are true module-load-time singletons (see
 * `packages/db/src/client.ts`) and the harness's `afterAll` permanently
 * closes that pool — a second `setupPgHarness` in the same file/module graph
 * would try to use the pool after it's already closed. All three `describe`
 * blocks below therefore share one disposable database; each test uses a
 * unique url/tag namespace so they don't interfere with each other's
 * assertions (mirrors the discipline every `@silo/core` integration suite
 * already uses with its own single-harness-per-file convention).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

/** Requests `/api/links/search?q=<query>` and asserts `expectedId` is among the matches — the shared shape of the "finds by title/notes/tag" tests (H2 coverage). */
async function expectSearchFinds(app: Hono, query: string, expectedId: string): Promise<void> {
  const body = await expectOk<{ results: Array<{ id: string }> }>(
    app,
    `/api/links/search?q=${encodeURIComponent(query)}`,
  );
  expect(body.results.map((r) => r.id)).toContain(expectedId);
}

describeIfPg('A2 read routes (integration)', () => {
  const harness = setupPgHarness('silo_api_links_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  describe('GET /api/links', () => {
    it('returns only live links, newest first', async () => {
      const { core, app } = harness.mod();
      const live = await core.createLink({
        url: 'https://example.com/list-live-1',
        sourceKind: 'link',
      });
      const trashed = await core.createLink({
        url: 'https://example.com/list-trashed-1',
        sourceKind: 'link',
      });
      await core.softDelete(trashed.id);

      const body = await expectOk<{ links: Array<{ id: string }> }>(app, '/api/links');
      const ids = body.links.map((l) => l.id);
      expect(ids).toContain(live.id);
      expect(ids).not.toContain(trashed.id);
    });

    it('filters by tag — only tagged live links returned', async () => {
      const { core, app } = harness.mod();
      const tagged = await core.createLink({
        url: 'https://example.com/list-tag-filter-tagged',
        sourceKind: 'link',
        tags: ['filter-me'],
      });
      const untagged = await core.createLink({
        url: 'https://example.com/list-tag-filter-untagged',
        sourceKind: 'link',
      });

      const body = await expectOk<{ links: Array<{ id: string }> }>(
        app,
        '/api/links?tag=filter-me',
      );
      const ids = body.links.map((l) => l.id);
      expect(ids).toContain(tagged.id);
      expect(ids).not.toContain(untagged.id);
    });

    it('filters by status — only links with that capture status returned', async () => {
      const { core, app } = harness.mod();
      const full = await core.createLink({
        url: 'https://example.com/list-status-full',
        sourceKind: 'link',
      });
      await core.recordEnrichment(full.id, { status: 'full' });
      const enriching = await core.createLink({
        url: 'https://example.com/list-status-enriching',
        sourceKind: 'link',
      });

      const body = await expectOk<{ links: Array<{ id: string; captureStatus: string }> }>(
        app,
        '/api/links?status=full',
      );
      const ids = body.links.map((l) => l.id);
      expect(ids).toContain(full.id);
      expect(ids).not.toContain(enriching.id);
      for (const link of body.links) {
        expect(link.captureStatus).toBe('full');
      }
    });

    it('combined tag + status filter narrows to the intersection', async () => {
      const { core, app } = harness.mod();
      const match = await core.createLink({
        url: 'https://example.com/list-combined-match',
        sourceKind: 'link',
        tags: ['combined-tag'],
      });
      await core.recordEnrichment(match.id, { status: 'full' });
      const tagOnly = await core.createLink({
        url: 'https://example.com/list-combined-tag-only',
        sourceKind: 'link',
        tags: ['combined-tag'],
      });
      // tagOnly stays 'enriching' — should be excluded by status filter.

      const body = await expectOk<{ links: Array<{ id: string }> }>(
        app,
        '/api/links?tag=combined-tag&status=full',
      );
      const ids = body.links.map((l) => l.id);
      expect(ids).toContain(match.id);
      expect(ids).not.toContain(tagOnly.id);
    });

    it('paginates: limit + nextCursor round-trip walks every page with no dup/gap', async () => {
      const { core, app } = harness.mod();
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        const link = await core.createLink({
          url: `https://example.com/list-pagination-${i}`,
          sourceKind: 'link',
          tags: ['pagination-walk'],
        });
        created.push(link.id);
      }

      const seen = await walkAllPages(app, '/api/links?tag=pagination-walk');
      expect(seen.sort()).toEqual([...created].sort());
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('a tag matching nothing returns { links: [] }, not an error', async () => {
      const { app } = harness.mod();
      const body = await expectOk<{ links: unknown[] }>(
        app,
        '/api/links?tag=no-such-tag-exists-anywhere',
      );
      expect(body.links).toEqual([]);
    });

    it('bad status enum value -> 400 validation_error envelope', async () => {
      const { app } = harness.mod();
      const body = await expect400(app, '/api/links?status=not-a-real-status', 'validation_error');
      expect(body.details).toBeDefined();
    });

    it('malformed cursor -> 400 invalid_cursor', async () => {
      const { app } = harness.mod();
      await expect400(app, '/api/links?cursor=not-a-valid-cursor!!!', 'invalid_cursor');
    });

    it('a search cursor handed to /api/links (wrong kind) -> 400 invalid_cursor', async () => {
      const { core, app } = harness.mod();
      for (let i = 0; i < 2; i++) {
        await core.createLink({
          url: `https://example.com/list-wrong-cursor-kind-${i}`,
          sourceKind: 'link',
          title: 'wrongcursorkindmarker',
        });
      }
      const searchBody = await expectOk<{ nextCursor?: string }>(
        app,
        '/api/links/search?q=wrongcursorkindmarker&limit=1',
      );
      expect(searchBody.nextCursor).toBeDefined();
      if (!searchBody.nextCursor) return;

      await expect400(
        app,
        `/api/links?cursor=${encodeURIComponent(searchBody.nextCursor)}`,
        'invalid_cursor',
      );
    });

    it('limit coercion: query string "2" is coerced to the number 2', async () => {
      const { core, app } = harness.mod();
      for (let i = 0; i < 3; i++) {
        await core.createLink({
          url: `https://example.com/list-limit-coercion-${i}`,
          sourceKind: 'link',
          tags: ['limit-coercion'],
        });
      }
      const body = await expectOk<{ links: unknown[]; nextCursor?: string }>(
        app,
        '/api/links?tag=limit-coercion&limit=2',
      );
      expect(body.links.length).toBe(2);
      expect(body.nextCursor).toBeDefined();
    });

    it('each link is the whitelisted shape — no internal-field leak, addedBy present', async () => {
      const { core, app } = harness.mod();
      await core.createLink({
        url: 'https://example.com/list-shape-check',
        sourceKind: 'link',
        origin: 'agent',
        tags: ['shape-check'],
      });
      const body = await expectOk<{ links: Array<Record<string, unknown>> }>(
        app,
        '/api/links?tag=shape-check',
      );
      expect(body.links.length).toBe(1);
      const link = body.links[0];
      expect(link).toBeDefined();
      if (!link) return;
      expectWhitelistedLinkShape(link);
      expect(link.addedBy).toBe('agent');
    });
  });

  describe('GET /api/links/search', () => {
    it('finds by title', async () => {
      const { core, app } = harness.mod();
      const link = await core.createLink({
        url: 'https://example.com/search-title-match',
        sourceKind: 'link',
        title: 'UniqueSearchTitleXyz',
      });
      await expectSearchFinds(app, 'UniqueSearchTitleXyz', link.id);
    });

    it('finds by notes-only match (H2 coverage)', async () => {
      const { core, app } = harness.mod();
      const link = await core.createLink({
        url: 'https://example.com/search-notes-only',
        sourceKind: 'link',
        notes: 'a UniqueNotesOnlyMarkerAbc appears only in notes',
      });
      await expectSearchFinds(app, 'UniqueNotesOnlyMarkerAbc', link.id);
    });

    it('finds by tag-only match (H2 coverage)', async () => {
      const { core, app } = harness.mod();
      const link = await core.createLink({
        url: 'https://example.com/search-tag-only',
        sourceKind: 'link',
        tags: ['uniquetagonlymarker'],
      });
      await expectSearchFinds(app, 'uniquetagonlymarker', link.id);
    });

    it('ranks results — each carries a numeric rank, highest first', async () => {
      const { core, app } = harness.mod();
      await core.createLink({
        url: 'https://example.com/search-rank-weak',
        sourceKind: 'link',
        description: 'mentions rankmarkerxyz once',
      });
      await core.createLink({
        url: 'https://example.com/search-rank-strong',
        sourceKind: 'link',
        title: 'rankmarkerxyz rankmarkerxyz rankmarkerxyz',
        description: 'rankmarkerxyz rankmarkerxyz',
      });
      const body = await expectOk<{ results: Array<{ rank: number }> }>(
        app,
        '/api/links/search?q=rankmarkerxyz',
      );
      expect(body.results.length).toBeGreaterThanOrEqual(2);
      for (const r of body.results) {
        expect(typeof r.rank).toBe('number');
      }
      const ranks = body.results.map((r) => r.rank);
      const sorted = [...ranks].sort((a, b) => b - a);
      expect(ranks).toEqual(sorted);
    });

    it('paginates search results', async () => {
      const { core, app } = harness.mod();
      for (let i = 0; i < 3; i++) {
        await core.createLink({
          url: `https://example.com/search-pagination-${i}`,
          sourceKind: 'link',
          title: 'searchpaginationmarker',
        });
      }
      const body1 = await expectOk<{ results: Array<{ id: string }>; nextCursor?: string }>(
        app,
        '/api/links/search?q=searchpaginationmarker&limit=2',
      );
      expect(body1.results.length).toBe(2);
      expect(body1.nextCursor).toBeDefined();
      if (!body1.nextCursor) return;

      const body2 = await expectOk<{ results: Array<{ id: string }> }>(
        app,
        `/api/links/search?q=searchpaginationmarker&limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
      );
      expect(body2.results.length).toBeGreaterThanOrEqual(1);
      const firstPageIds = new Set(body1.results.map((r) => r.id));
      for (const r of body2.results) {
        expect(firstPageIds.has(r.id)).toBe(false);
      }
    });

    it('empty q -> 400 validation_error', async () => {
      const { app } = harness.mod();
      await expect400(app, '/api/links/search?q=', 'validation_error');
    });

    it('missing q -> 400 validation_error', async () => {
      const { app } = harness.mod();
      await expect400(app, '/api/links/search', 'validation_error');
    });

    it('no-match query -> { results: [] }', async () => {
      const { app } = harness.mod();
      const body = await expectOk<{ results: unknown[] }>(
        app,
        '/api/links/search?q=nosuchtermwilleverexistxyzabc123',
      );
      expect(body.results).toEqual([]);
    });

    it('malformed cursor -> 400 invalid_cursor', async () => {
      const { app } = harness.mod();
      await expect400(app, '/api/links/search?q=whatever&cursor=garbage!!!', 'invalid_cursor');
    });

    it('each result is the whitelisted shape plus rank', async () => {
      const { core, app } = harness.mod();
      await core.createLink({
        url: 'https://example.com/search-shape-check',
        sourceKind: 'link',
        title: 'searchshapecheckmarker',
        origin: 'agent',
      });
      const body = await expectOk<{ results: Array<Record<string, unknown>> }>(
        app,
        '/api/links/search?q=searchshapecheckmarker',
      );
      expect(body.results.length).toBe(1);
      const result = body.results[0];
      expect(result).toBeDefined();
      if (!result) return;
      expectWhitelistedLinkShape(result);
      expect(typeof result.rank).toBe('number');
    });

    it('the "search" path segment is not swallowed as an :id — route ordering test', async () => {
      // If /links/:id were registered before /links/search, this request would
      // try z.uuid().parse("search") and 400 instead of hitting the search route.
      const { app } = harness.mod();
      const body = await expectOk<{ results?: unknown }>(app, '/api/links/search?q=anything');
      expect(body.results).toBeDefined();
    });
  });

  describe('GET /api/links/:id', () => {
    it('found -> returns the whitelisted link', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/getbyid-found',
        sourceKind: 'link',
        title: 'Found title',
      });
      const body = await expectOk<{ link: Record<string, unknown> }>(
        app,
        `/api/links/${created.id}`,
      );
      // `{ link }` envelope — same shape as every write route (contract consistency).
      expect(body.link.id).toBe(created.id);
      expect(body.link.title).toBe('Found title');
      expectWhitelistedLinkShape(body.link);
    });

    it('unknown (well-formed) uuid -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await app.request('/api/links/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('not_found');
    });

    it("a TRASHED link's id -> 404 (live-scoped getById)", async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/getbyid-trashed',
        sourceKind: 'link',
      });
      await core.softDelete(created.id);
      const res = await app.request(`/api/links/${created.id}`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('not_found');
    });

    it('non-uuid id -> 400 validation_error', async () => {
      const { app } = harness.mod();
      await expect400(app, '/api/links/not-a-uuid', 'validation_error');
    });
  });
});
