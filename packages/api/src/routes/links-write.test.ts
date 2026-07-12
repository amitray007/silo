import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import { expectWhitelistedLinkShape } from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for the A3 write routes (plan 007), driven via
 * Hono's `app.request(...)` against a real Postgres (see `docs/rules/
 * testing.md` — dedup/merge, tag case-folding, and live-scoping are database
 * behaviors mocks can't prove). Covers `POST /api/links` (capture),
 * `PATCH /api/links/:id` (edit), `POST /api/links/:id/tags` /
 * `DELETE /api/links/:id/tags/:tag` (tag add/remove), and `POST /api/tags`
 * (standalone create-tag).
 *
 * ONE `setupPgHarness` call for the whole file (mirrors `links.test.ts`'s A2
 * suite — `@silo/db`'s `pool`/`db` are true module-load-time singletons and
 * the harness's `afterAll` permanently closes that pool, so a second
 * `setupPgHarness` in the same file would reuse an already-closed pool).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

/** POSTs a JSON `body` to `path` on `app` — the shared request-building boilerplate every write-route test needs (Hono's `app.request` takes a `Request`-like init, not a bare object). */
async function postJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** PATCHes a JSON `body` to `path` on `app`. */
async function patchJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** DELETEs `path` on `app` (no body — used for the remove-tag route). */
async function del(app: Hono, path: string): Promise<Response> {
  return app.request(path, { method: 'DELETE' });
}

/** Asserts `res` is a 400 with the given `error` code, returning the parsed envelope — the write-route analogue of `assertions.ts`'s `expect400` (that one only drives GET). */
async function expect400Response(res: Response, errorCode: string): Promise<ErrorEnvelope> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as ErrorEnvelope;
  expect(body.error).toBe(errorCode);
  return body;
}

/** Asserts `res` is a 404 with `error: 'not_found'`. */
async function expect404Response(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  const body = (await res.json()) as ErrorEnvelope;
  expect(body.error).toBe('not_found');
}

describeIfPg('A3 write routes (integration)', () => {
  const harness = setupPgHarness('silo_api_links_write_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    const { pool } = await import('@silo/db');
    return { core, app: createApp(), pool };
  });

  /** Total row count in `links` (including trashed) — proves the bad-URL guard saves NOTHING, not merely "no live link" (mirrors `capture-link.test.ts`'s MCP-side `totalLinkCount`). */
  async function totalLinkCount(): Promise<number> {
    const { pool } = harness.mod();
    const result = await pool.query<{ count: string }>('select count(*) from links');
    return Number(result.rows[0]?.count ?? '0');
  }

  describe('POST /api/links', () => {
    it('fresh capture -> 201, enriching status, user origin, tags attached, deduped false', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/write-capture-fresh',
        tags: ['fresh-capture-tag'],
        note: 'a fresh note',
        sourceKind: 'link',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown>; deduped: boolean };
      expect(body.deduped).toBe(false);
      expectWhitelistedLinkShape(body.link);
      expect(body.link.captureStatus).toBe('enriching');
      // Web capture is USER origin — the `◆` mark is agent-only (MCP's job).
      expect(body.link.addedBy).toBe('user');
      expect(body.link.tags).toEqual(['fresh-capture-tag']);
      expect(body.link.notes).toBe('a fresh note');
      expect(body.link.url).toBe('https://example.com/write-capture-fresh');
    });

    it('re-capturing the same url -> deduped true, same id, notes appended', async () => {
      const { app } = harness.mod();
      const url = 'https://example.com/write-capture-dedup';
      const first = await postJson(app, '/api/links', { url, note: 'first note' });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { link: { id: string }; deduped: boolean };
      expect(firstBody.deduped).toBe(false);

      const second = await postJson(app, '/api/links', { url, note: 'second note' });
      expect(second.status).toBe(201);
      const secondBody = (await second.json()) as {
        link: { id: string; notes: string | null };
        deduped: boolean;
      };
      expect(secondBody.deduped).toBe(true);
      expect(secondBody.link.id).toBe(firstBody.link.id);
      expect(secondBody.link.notes).toContain('first note');
      expect(secondBody.link.notes).toContain('second note');
    });

    it('bad URLs -> 400 invalid_url, NOTHING saved (checked after EACH input)', async () => {
      const { app } = harness.mod();
      const badUrls = [
        'javascript:alert(1)',
        'not a url',
        'data:text/plain;base64,aGVsbG8=',
        `https://example.com/${'a'.repeat(9000)}`,
      ];
      for (const url of badUrls) {
        const before = await totalLinkCount();
        const res = await postJson(app, '/api/links', { url });
        const body = await expect400Response(res, 'invalid_url');
        expect(body.message).toContain('nothing was saved');
        const after = await totalLinkCount();
        expect(after).toBe(before);
      }
    });

    it('missing url in body -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', { tags: ['no-url'] });
      await expect400Response(res, 'validation_error');
    });

    it('bad sourceKind enum -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/write-capture-bad-source-kind',
        sourceKind: 'not-a-real-kind',
      });
      await expect400Response(res, 'validation_error');
    });

    it('the response link is the whitelisted shape (no internal-field leak)', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/write-capture-shape-check',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expectWhitelistedLinkShape(body.link);
    });

    it('explicit source -> stored on the link (capture-source slice)', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/write-capture-source-web',
        source: 'web',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expect(body.link.source).toBe('web');
    });

    it('no source in body -> stored as "unknown" (never hardcoded "web" by this route)', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/write-capture-source-omitted',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expect(body.link.source).toBe('unknown');
    });

    it('invalid source enum value -> 400 validation_error, nothing saved', async () => {
      const { app } = harness.mod();
      const before = await totalLinkCount();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/write-capture-source-bogus',
        source: 'bogus',
      });
      await expect400Response(res, 'validation_error');
      const after = await totalLinkCount();
      expect(after).toBe(before);
    });

    it('REGRESSION (plan 020): sourceData in the body is IGNORED, never injected — the public capture route has no sourceData field; that trust boundary lives only at POST /api/ingest (see ingest.test.ts)', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/write-capture-sourcedata-injection-attempt',
        sourceKind: 'twitter',
        // An arbitrary cross-origin caller attempting to forge rich
        // sourceData (fake engagement stats) via the PUBLIC capture body.
        sourceData: {
          kind: 'twitter',
          text: 'forged',
          authorHandle: 'x',
          authorName: 'X',
          likes: 999_999_999,
          reposts: 0,
          replies: 0,
          quotes: 0,
          bookmarks: 0,
        },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown> };
      // sourceKind is still honored for routing/enrichment classification,
      // but sourceData is NEVER bound from this body — it stays the safe
      // `{kind:'link'}` floor createLink's resolveSource falls back to.
      expect(body.link.sourceKind).toBe('twitter');
      expect(body.link.sourceData).toEqual({ kind: 'link' });
    });
  });

  describe('PATCH /api/links/:id', () => {
    it('edits title/description/note — persists (re-GET confirms)', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-edit-persists',
        sourceKind: 'link',
      });

      const res = await patchJson(app, `/api/links/${created.id}`, {
        title: 'Edited Title',
        description: 'Edited description',
        note: 'Edited note',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expect(body.link.title).toBe('Edited Title');
      expect(body.link.description).toBe('Edited description');
      expect(body.link.notes).toBe('Edited note');

      // Re-GET to confirm the edit actually persisted, not just echoed back.
      const getRes = await app.request(`/api/links/${created.id}`);
      const getBody = (await getRes.json()) as { link: Record<string, unknown> };
      expect(getBody.link.title).toBe('Edited Title');
      expect(getBody.link.description).toBe('Edited description');
      expect(getBody.link.notes).toBe('Edited note');
    });

    it('unknown id -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await patchJson(app, '/api/links/00000000-0000-0000-0000-000000000000', {
        title: 'x',
      });
      await expect404Response(res);
    });

    it('trashed id -> 404 not_found', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-edit-trashed',
        sourceKind: 'link',
      });
      await core.softDelete(created.id);

      const res = await patchJson(app, `/api/links/${created.id}`, { title: 'x' });
      await expect404Response(res);
    });

    it('non-uuid id -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await patchJson(app, '/api/links/not-a-uuid', { title: 'x' });
      await expect400Response(res, 'validation_error');
    });

    it('empty body -> 200, returns current (unchanged) link', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-edit-empty-body',
        sourceKind: 'link',
        title: 'Original Title',
      });

      const res = await patchJson(app, `/api/links/${created.id}`, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expect(body.link.title).toBe('Original Title');
      expect(body.link.id).toBe(created.id);
    });
  });

  describe('POST /api/links/:id/tags', () => {
    it('adds a tag -> 200 with tag in link.tags', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-add-tag-basic',
        sourceKind: 'link',
      });

      const res = await postJson(app, `/api/links/${created.id}/tags`, { tag: 'newly-added' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: { tags: string[] } };
      expect(body.link.tags).toContain('newly-added');
    });

    it('idempotent — adding the same tag twice still yields one tag', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-add-tag-idempotent',
        sourceKind: 'link',
      });

      await postJson(app, `/api/links/${created.id}/tags`, { tag: 'repeat-tag' });
      const res = await postJson(app, `/api/links/${created.id}/tags`, { tag: 'repeat-tag' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: { tags: string[] } };
      const count = body.link.tags.filter((t) => t === 'repeat-tag').length;
      expect(count).toBe(1);
    });

    it('case-insensitive — adding "AI" then "ai" yields one tag (W1)', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-add-tag-case-insensitive',
        sourceKind: 'link',
      });

      await postJson(app, `/api/links/${created.id}/tags`, { tag: 'AI' });
      const res = await postJson(app, `/api/links/${created.id}/tags`, { tag: 'ai' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: { tags: string[] } };
      const matches = body.link.tags.filter((t) => t.toLowerCase() === 'ai');
      expect(matches.length).toBe(1);
    });

    it('unknown id -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links/00000000-0000-0000-0000-000000000000/tags', {
        tag: 'x',
      });
      await expect404Response(res);
    });

    it('trashed link -> 404 not_found', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-add-tag-trashed',
        sourceKind: 'link',
      });
      await core.softDelete(created.id);

      const res = await postJson(app, `/api/links/${created.id}/tags`, { tag: 'x' });
      await expect404Response(res);
    });

    it('missing tag body -> 400 validation_error', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-add-tag-missing-body',
        sourceKind: 'link',
      });
      const res = await postJson(app, `/api/links/${created.id}/tags`, {});
      await expect400Response(res, 'validation_error');
    });
  });

  describe('DELETE /api/links/:id/tags/:tag', () => {
    it('removes a tag -> 200, tag gone', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-remove-tag-basic',
        sourceKind: 'link',
        tags: ['to-remove'],
      });

      const res = await del(app, `/api/links/${created.id}/tags/to-remove`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: { tags: string[] } };
      expect(body.link.tags).not.toContain('to-remove');
    });

    it('removes by different case — "AI" removes via "ai"', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-remove-tag-case',
        sourceKind: 'link',
        tags: ['AI'],
      });

      const res = await del(app, `/api/links/${created.id}/tags/ai`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: { tags: string[] } };
      expect(body.link.tags.map((t) => t.toLowerCase())).not.toContain('ai');
    });

    it('removing an absent tag -> 200, no-op', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-remove-tag-absent',
        sourceKind: 'link',
        tags: ['stays'],
      });

      const res = await del(app, `/api/links/${created.id}/tags/never-was-there`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: { tags: string[] } };
      expect(body.link.tags).toContain('stays');
    });

    it('unknown link id -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await del(app, '/api/links/00000000-0000-0000-0000-000000000000/tags/whatever');
      await expect404Response(res);
    });

    it('trashed link -> 404 not_found', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/write-remove-tag-trashed',
        sourceKind: 'link',
        tags: ['doomed'],
      });
      await core.softDelete(created.id);

      const res = await del(app, `/api/links/${created.id}/tags/doomed`);
      await expect404Response(res);
    });
  });

  describe('POST /api/tags', () => {
    it('creates a standalone tag -> 201 { name }', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/tags', { name: 'standalone-fresh' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { name: string };
      expect(body.name).toBe('standalone-fresh');
    });

    it('case-insensitive idempotent — "AI" then "ai" -> one tag, canonical (first-entered) name', async () => {
      const { app } = harness.mod();
      const first = await postJson(app, '/api/tags', { name: 'AI-standalone' });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { name: string };
      expect(firstBody.name).toBe('AI-standalone');

      const second = await postJson(app, '/api/tags', { name: 'ai-standalone' });
      expect(second.status).toBe(201);
      const secondBody = (await second.json()) as { name: string };
      // Canonical display name is the first-entered casing.
      expect(secondBody.name).toBe('AI-standalone');
    });

    it('blank name -> 400 (whitespace-only passes min(1) but core.createTag returns null)', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/tags', { name: '   ' });
      await expect400Response(res, 'validation_error');
    });

    it('missing name -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/tags', {});
      await expect400Response(res, 'validation_error');
    });
  });

  describe('POST /api/links/batch/tags — bulk add-tag (U5)', () => {
    it('mixed good/bad id batch: good ids get tagged, bad id reported per-item, batch not sunk', async () => {
      const { core, app } = harness.mod();
      const a = await core.createLink({
        url: 'https://example.com/u5-batch-tag-a',
        sourceKind: 'link',
      });
      const b = await core.createLink({
        url: 'https://example.com/u5-batch-tag-b',
        sourceKind: 'link',
      });
      const bogusId = '00000000-0000-0000-0000-000000000000';

      const res = await postJson(app, '/api/links/batch/tags', {
        ids: [a.id, b.id, bogusId],
        tag: 'u5-batch-tag',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: Array<{ id: string; ok: boolean; reason?: string }>;
      };
      expect(body.results.find((r) => r.id === a.id)?.ok).toBe(true);
      expect(body.results.find((r) => r.id === b.id)?.ok).toBe(true);
      expect(body.results.find((r) => r.id === bogusId)?.ok).toBe(false);

      const aAfter = await core.getById(a.id);
      expect(aAfter?.tags).toContain('u5-batch-tag');
      const bAfter = await core.getById(b.id);
      expect(bAfter?.tags).toContain('u5-batch-tag');
    });

    it('empty ids array -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links/batch/tags', { ids: [], tag: 'whatever' });
      await expect400Response(res, 'validation_error');
    });

    it('over MAX_BULK_IDS (501) -> clean 400 validation_error, not a raw core error', async () => {
      const { app } = harness.mod();
      const ids = Array.from({ length: 501 }, () => '00000000-0000-0000-0000-000000000000');
      const res = await postJson(app, '/api/links/batch/tags', { ids, tag: 'too-many' });
      const body = await expect400Response(res, 'validation_error');
      expect(body.message).toContain('500');
    });
  });

  describe('POST /api/links/batch/untag — bulk remove-tag (U5)', () => {
    it('removes the tag from every id in the batch', async () => {
      const { core, app } = harness.mod();
      const a = await core.createLink({
        url: 'https://example.com/u5-batch-untag-a',
        sourceKind: 'link',
        tags: ['u5-batch-untag'],
      });
      const res = await postJson(app, '/api/links/batch/untag', {
        ids: [a.id],
        tag: 'u5-batch-untag',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: Array<{ id: string; ok: boolean }> };
      expect(body.results[0]?.ok).toBe(true);
      const after = await core.getById(a.id);
      expect(after?.tags).not.toContain('u5-batch-untag');
    });
  });

  describe('POST /api/links/batch/capture — bulk capture (U5)', () => {
    it('captures multiple urls, per-item results keyed by url', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links/batch/capture', {
        urls: ['https://example.com/u5-batch-capture-1', 'https://example.com/u5-batch-capture-2'],
        tags: ['u5-batch-capture'],
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        results: Array<{ url: string; ok: boolean; id?: string; deduped?: boolean }>;
      };
      expect(body.results.length).toBe(2);
      for (const r of body.results) {
        expect(r.ok).toBe(true);
        expect(r.id).toBeDefined();
      }
    });

    it('bad url in the batch is reported per-item, does not sink the batch', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links/batch/capture', {
        urls: ['https://example.com/u5-batch-capture-good', 'javascript:alert(1)'],
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        results: Array<{ url: string; ok: boolean; reason?: string }>;
      };
      const good = body.results.find((r) => r.url === 'https://example.com/u5-batch-capture-good');
      expect(good?.ok).toBe(true);
    });

    it('empty urls array -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links/batch/capture', { urls: [] });
      await expect400Response(res, 'validation_error');
    });
  });

  describe('POST /api/links/batch-get — batch read (U5)', () => {
    it('returns full extractedText per id, unknown id -> { id, link: null }', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/u5-batch-get',
        sourceKind: 'link',
      });
      await core.recordEnrichment(created.id, { status: 'full', text: 'full body text' });
      const bogusId = '00000000-0000-0000-0000-000000000000';

      const res = await postJson(app, '/api/links/batch-get', { ids: [created.id, bogusId] });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        results: Array<{ id: string; link: Record<string, unknown> | null }>;
      };
      const found = body.results.find((r) => r.id === created.id);
      expect(found?.link?.extractedText).toBe('full body text');
      const missing = body.results.find((r) => r.id === bogusId);
      expect(missing?.link).toBeNull();
    });

    it('empty ids array -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links/batch-get', { ids: [] });
      await expect400Response(res, 'validation_error');
    });
  });
});
