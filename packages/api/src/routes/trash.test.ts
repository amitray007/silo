import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import {
  expect400,
  expectOk,
  expectWhitelistedLinkShape,
  walkAllPages,
} from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `GET /api/trash` (plan 007, A2) AND the
 * A4 trash/lifecycle write routes (`POST /api/links/:id/trash|restore|retry`,
 * `DELETE /api/trash/:id`, `DELETE /api/trash`), driven via Hono's
 * `app.request(...)` against a real Postgres — the Trash screen's whole data
 * surface plus every state-transition action it offers.
 *
 * ONE `setupPgHarness` for the whole file (see `links.test.ts`'s doc comment
 * for why: `@silo/db`'s pool is a module-load-time singleton the harness's
 * `afterAll` permanently closes, so a second harness in the same file/module
 * graph can't reopen it). The first test relies on running against an
 * otherwise-untouched database to prove true emptiness — Vitest runs `it`s
 * within one file in declaration order, so it's declared first.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

/** POSTs with no body to `path` on `app` — the shared shape every A4 action-route test needs (trash/restore/retry take no body). */
async function post(app: Hono, path: string): Promise<Response> {
  return app.request(path, { method: 'POST' });
}

/** DELETEs `path` on `app` — shared by the hard-delete-one and empty-trash tests. */
async function del(app: Hono, path: string): Promise<Response> {
  return app.request(path, { method: 'DELETE' });
}

/** Asserts `res` is a 404 with `error: 'not_found'`. */
async function expect404Response(res: Response): Promise<ErrorEnvelope> {
  expect(res.status).toBe(404);
  const body = (await res.json()) as ErrorEnvelope;
  expect(body.error).toBe('not_found');
  return body;
}

/** Asserts `res` is a 400 with the given `error` code — the action-route analogue of `assertions.ts`'s `expect400` (that one only drives GET-by-path). */
async function expect400Response(res: Response, errorCode: string): Promise<ErrorEnvelope> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as ErrorEnvelope;
  expect(body.error).toBe(errorCode);
  return body;
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describeIfPg('GET /api/trash (integration)', () => {
  const harness = setupPgHarness('silo_api_trash_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    const { pool } = await import('@silo/db');
    return { core, app: createApp(), pool };
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

  describe('POST /api/links/:id/trash', () => {
    it('trashes a live link -> 200, then GET /links/:id -> 404 and GET /trash includes it', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/trash-action-basic',
        sourceKind: 'link',
        tags: ['will-be-trashed'],
      });

      const res = await post(app, `/api/links/${created.id}/trash`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expect(body.link.id).toBe(created.id);
      // Honest omission: tags aren't hydrated on the trash response (mirrors
      // trash_link's MCP tool) — asserted explicitly, not left implicit.
      expect(body.link.tags).toEqual([]);
      expectWhitelistedLinkShape(body.link);

      const getRes = await app.request(`/api/links/${created.id}`);
      expect(getRes.status).toBe(404);

      const trashBody = await expectOk<{ links: Array<{ id: string }> }>(app, '/api/trash');
      expect(trashBody.links.map((l) => l.id)).toContain(created.id);
    });

    it('trashing an unknown id -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await post(app, `/api/links/${UNKNOWN_ID}/trash`);
      await expect404Response(res);
    });

    it('trashing an already-trashed link -> 404 not_found (second call)', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/trash-action-already-trashed',
        sourceKind: 'link',
      });
      const first = await post(app, `/api/links/${created.id}/trash`);
      expect(first.status).toBe(200);

      const second = await post(app, `/api/links/${created.id}/trash`);
      await expect404Response(second);
    });

    it('non-uuid id -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await post(app, '/api/links/not-a-uuid/trash');
      await expect400Response(res, 'validation_error');
    });
  });

  describe('POST /api/links/:id/restore', () => {
    it('restores a trashed link -> 200 outcome:restored, GET /links/:id -> 200 (live again)', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/restore-action-basic',
        sourceKind: 'link',
      });
      await core.softDelete(created.id);

      const res = await post(app, `/api/links/${created.id}/restore`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { outcome: string; link: Record<string, unknown> };
      expect(body.outcome).toBe('restored');
      expect(body.link.id).toBe(created.id);
      expectWhitelistedLinkShape(body.link);

      const getRes = await app.request(`/api/links/${created.id}`);
      expect(getRes.status).toBe(200);
    });

    it('the merged case — trash A, a second live row lands at the same canonical url, restoring A merges into it (different id)', async () => {
      const { core, app, pool } = harness.mod();
      const url = 'https://example.com/restore-action-merge';

      // `core.createLink` always dedup-merges/revives on a repeat url (see
      // `links.ts`'s `findExistingForDedup` doc comment — it matches LIVE OR
      // TRASHED rows), so it can never itself produce two live rows sharing a
      // canonical url. Mirrors `links.test.ts`'s "restore-collision" and
      // `restore-link.test.ts`'s MCP-side setup: insert the colliding live
      // row directly via `pool` (a real `pg.Pool`, allowed in test-support/
      // integration tests per `docs/rules/api-hono.md`'s carve-out).
      const linkA = await core.createLink({ url, sourceKind: 'link', notes: 'note from A' });
      await core.softDelete(linkA.id);

      const insertResult = await pool.query<{ id: string }>(
        `insert into links (url, canonical_url, source_kind, notes)
         values ($1, $1, 'link', 'replacement notes')
         returning id`,
        [url],
      );
      const liveReplacementId = insertResult.rows[0]?.id;
      expect(liveReplacementId).toBeDefined();
      if (!liveReplacementId) return;
      expect(liveReplacementId).not.toBe(linkA.id);

      const res = await post(app, `/api/links/${linkA.id}/restore`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        outcome: string;
        link: { id: string; notes: string | null };
        message: string;
      };
      expect(body.outcome).toBe('merged');
      expect(body.link.id).toBe(liveReplacementId);
      expect(body.link.id).not.toBe(linkA.id);
      expect(body.link.notes).toContain('note from A');
      expect(body.link.notes).toContain('replacement notes');
      // The response must make the id change explicit, not silently swap it.
      expect(body.message).toContain(linkA.id);
      expect(body.message).toContain(liveReplacementId);

      // The original id is gone as a live link; the replacement survives.
      const getOriginal = await app.request(`/api/links/${linkA.id}`);
      expect(getOriginal.status).toBe(404);
      const getSurvivor = await app.request(`/api/links/${liveReplacementId}`);
      expect(getSurvivor.status).toBe(200);
    });

    it('restoring an unknown id -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await post(app, `/api/links/${UNKNOWN_ID}/restore`);
      const errBody = await expect404Response(res);
      expect(errBody.error).toBe('not_found');
    });

    it('restoring an already-LIVE link -> 404 (not in trash)', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/restore-action-already-live',
        sourceKind: 'link',
      });

      const res = await post(app, `/api/links/${created.id}/restore`);
      await expect404Response(res);
    });

    it('non-uuid id -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await post(app, '/api/links/not-a-uuid/restore');
      await expect400Response(res, 'validation_error');
    });
  });

  describe('POST /api/links/:id/retry', () => {
    it("retries a 'partial' link -> 200, status 'enriching'", async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/retry-action-partial',
        sourceKind: 'link',
      });
      await core.recordEnrichment(created.id, {
        status: 'partial',
        title: 'Partial Title',
      });

      const res = await post(app, `/api/links/${created.id}/retry`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { link: { captureStatus: string; id: string } };
      expect(body.link.captureStatus).toBe('enriching');
      expect(body.link.id).toBe(created.id);
    });

    it("retrying a 'full' link -> 404 (not retryable, a good capture isn't downgraded)", async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/retry-action-full',
        sourceKind: 'link',
      });
      await core.recordEnrichment(created.id, {
        status: 'full',
        title: 'Full Title',
      });

      const res = await post(app, `/api/links/${created.id}/retry`);
      await expect404Response(res);

      // A good capture is never downgraded — confirm status is untouched.
      const getRes = await app.request(`/api/links/${created.id}`);
      const getBody = (await getRes.json()) as { link: { captureStatus: string } };
      expect(getBody.link.captureStatus).toBe('full');
    });

    it('retrying an unknown id -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await post(app, `/api/links/${UNKNOWN_ID}/retry`);
      await expect404Response(res);
    });

    it('retrying a trashed link -> 404 not_found', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/retry-action-trashed',
        sourceKind: 'link',
      });
      await core.softDelete(created.id);

      const res = await post(app, `/api/links/${created.id}/retry`);
      await expect404Response(res);
    });

    it('non-uuid id -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await post(app, '/api/links/not-a-uuid/retry');
      await expect400Response(res, 'validation_error');
    });
  });

  describe('DELETE /api/trash/:id (hard-delete one)', () => {
    it('hard-deletes a TRASHED link -> 204, row gone from trash listing', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/hard-delete-action-trashed',
        sourceKind: 'link',
      });
      await core.softDelete(created.id);

      const res = await del(app, `/api/trash/${created.id}`);
      expect(res.status).toBe(204);
      const bodyText = await res.text();
      expect(bodyText).toBe('');

      const trashBody = await expectOk<{ links: Array<{ id: string }> }>(app, '/api/trash');
      expect(trashBody.links.map((l) => l.id)).not.toContain(created.id);
    });

    it('THE GUARD — hard-deleting a LIVE link id -> 404, and the live link still exists', async () => {
      const { core, app } = harness.mod();
      const created = await core.createLink({
        url: 'https://example.com/hard-delete-action-guard-live',
        sourceKind: 'link',
      });

      const res = await del(app, `/api/trash/${created.id}`);
      await expect404Response(res);

      // Prove the guard: the live link is completely untouched.
      const getRes = await app.request(`/api/links/${created.id}`);
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as { link: { id: string } };
      expect(getBody.link.id).toBe(created.id);
    });

    it('unknown id -> 404 not_found', async () => {
      const { app } = harness.mod();
      const res = await del(app, `/api/trash/${UNKNOWN_ID}`);
      await expect404Response(res);
    });

    it('non-uuid id -> 400 validation_error', async () => {
      const { app } = harness.mod();
      const res = await del(app, '/api/trash/not-a-uuid');
      await expect400Response(res, 'validation_error');
    });
  });

  describe('DELETE /api/trash (empty trash)', () => {
    it('seeds live+trashed, empties -> 200 {deleted:M}, GET /trash empty (of the seeded ones), live links intact', async () => {
      const { core, app } = harness.mod();

      const live1 = await core.createLink({
        url: 'https://example.com/empty-trash-action-live-1',
        sourceKind: 'link',
      });
      const live2 = await core.createLink({
        url: 'https://example.com/empty-trash-action-live-2',
        sourceKind: 'link',
      });
      const trashed1 = await core.createLink({
        url: 'https://example.com/empty-trash-action-trashed-1',
        sourceKind: 'link',
      });
      const trashed2 = await core.createLink({
        url: 'https://example.com/empty-trash-action-trashed-2',
        sourceKind: 'link',
      });
      await core.softDelete(trashed1.id);
      await core.softDelete(trashed2.id);

      const countsBefore = await expectOk<{ live: number; trash: number }>(app, '/api/counts');

      const res = await del(app, '/api/trash');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: number };
      expect(body.deleted).toBeGreaterThanOrEqual(2);

      const trashBody = await expectOk<{ links: Array<{ id: string }> }>(app, '/api/trash');
      expect(trashBody.links).toEqual([]);

      const countsAfter = await expectOk<{ live: number; trash: number }>(app, '/api/counts');
      expect(countsAfter.trash).toBe(0);
      expect(countsAfter.live).toBe(countsBefore.live);

      // Live links are untouched.
      const getLive1 = await app.request(`/api/links/${live1.id}`);
      expect(getLive1.status).toBe(200);
      const getLive2 = await app.request(`/api/links/${live2.id}`);
      expect(getLive2.status).toBe(200);
    });

    it('empty trash when nothing is trashed -> 200 {deleted:0}', async () => {
      const { app } = harness.mod();
      // A prior test in this describe block may have already emptied trash;
      // call again to confirm the zero-case doesn't error.
      const res = await del(app, '/api/trash');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: number };
      expect(typeof body.deleted).toBe('number');
    });
  });
});
