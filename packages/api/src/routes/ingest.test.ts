import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import { expectWhitelistedLinkShape } from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `POST /api/ingest` (CLI foundation slice,
 * plan 020) — the trusted, token-gated seam a future `silo ingest x` command
 * will call. Driven via Hono's `app.request(...)` against a real Postgres,
 * mirroring `links-write.test.ts`'s A3 suite structure exactly (same
 * `describeIfPg`/`setupPgHarness` pattern — dedup/merge and live-scoping are
 * database behaviors mocks can't prove, per `docs/rules/testing.md`).
 *
 * THE SECURITY PROPERTY UNDER TEST (ce-security's mandate per plan 020):
 * sourceData injection is possible ONLY from a caller presenting the exact
 * configured `SILO_API_TOKEN` as `Authorization: Bearer <token>` — never
 * without a token, never with the wrong token, and never via the public
 * `POST /api/links` at all (that route has no `sourceData` field in its
 * schema — see the regression test at the bottom of this file, and its
 * sibling in `links-write.test.ts`).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const TEST_TOKEN = 'test-ingest-token-do-not-use-in-prod';

/** POSTs a JSON `body` to `path` on `app`, optionally with an `Authorization`
 * header — mirrors `links-write.test.ts`'s `postJson` plus an auth option
 * (that file's helper has no auth concept since no other route needs one). */
async function postJson(
  app: Hono,
  path: string,
  body: unknown,
  authorization?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  return app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** A full Field-Theory-shaped twitter `sourceData` payload — the same shape
 * `source-data.test.ts` uses for its "full FT payload" happy-path case. */
function ftTwitterSourceData(): CoreOps.SourceData {
  return {
    kind: 'twitter',
    text: 'Check out http://originkit.dev — big update today',
    authorHandle: 'AdhamDannaway',
    authorName: 'Adham Dannaway',
    authorAvatarUrl: 'https://pbs.twimg.com/profile_images/123/avatar.jpg',
    likes: 120,
    reposts: 15,
    replies: 8,
    quotes: 2,
    bookmarks: 34,
    postedAt: 'Mon Jul 06 14:25:00 +0000 2026',
    language: 'en',
    possiblySensitive: false,
    mediaUrls: ['https://pbs.twimg.com/media/abc123.jpg'],
    externalLinks: ['http://originkit.dev'],
  };
}

describeIfPg('POST /api/ingest (integration)', () => {
  const harness = setupPgHarness('silo_api_ingest_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    const { pool } = await import('@silo/db');
    return { core, app: createApp(), pool };
  });

  beforeEach(() => {
    process.env.SILO_API_TOKEN = TEST_TOKEN;
  });

  afterEach(() => {
    delete process.env.SILO_API_TOKEN;
  });

  describe('trust gate — untrusted callers rejected', () => {
    it('token configured, no Authorization header -> 401 unauthorized, nothing saved', async () => {
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(app, '/api/ingest', {
        url: 'https://x.com/someone/status/1',
        sourceKind: 'twitter',
        sourceData: ftTwitterSourceData(),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('unauthorized');
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });

    it('wrong token -> 401 unauthorized, nothing saved', async () => {
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(
        app,
        '/api/ingest',
        {
          url: 'https://x.com/someone/status/2',
          sourceKind: 'twitter',
          sourceData: ftTwitterSourceData(),
        },
        'Bearer wrong-token',
      );
      expect(res.status).toBe(401);
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });

    it('malformed Authorization header (not "Bearer <token>") -> 401', async () => {
      const { app } = harness.mod();
      const res = await postJson(
        app,
        '/api/ingest',
        { url: 'https://x.com/someone/status/3', sourceKind: 'twitter' },
        TEST_TOKEN, // missing the "Bearer " prefix
      );
      expect(res.status).toBe(401);
    });

    it('SILO_API_TOKEN unset on the process -> 401 even with a well-formed Bearer header (endpoint closed by default, never falls open on loopback)', async () => {
      delete process.env.SILO_API_TOKEN;
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(
        app,
        '/api/ingest',
        {
          url: 'https://x.com/someone/status/4',
          sourceKind: 'twitter',
          sourceData: ftTwitterSourceData(),
        },
        'Bearer anything-at-all',
      );
      expect(res.status).toBe(401);
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });

    it('empty-string SILO_API_TOKEN is treated as unset -> 401 (no accidental empty-token bypass)', async () => {
      process.env.SILO_API_TOKEN = '';
      const { app } = harness.mod();
      const res = await postJson(
        app,
        '/api/ingest',
        { url: 'https://x.com/someone/status/5', sourceKind: 'twitter' },
        'Bearer ',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('trusted caller — accepts + writes rich sourceData', () => {
    it('valid token + full FT-shaped twitter sourceData -> 201, link + sourceData persisted, readable via GET /api/links/:id', async () => {
      const { app } = harness.mod();
      const sourceData = ftTwitterSourceData();
      const res = await postJson(
        app,
        '/api/ingest',
        {
          url: 'https://x.com/AdhamDannaway/status/1234567890123456789',
          sourceKind: 'twitter',
          note: sourceData.kind === 'twitter' ? sourceData.text : undefined,
          sourceData,
        },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown>; deduped: boolean };
      expect(body.deduped).toBe(false);
      expectWhitelistedLinkShape(body.link);
      expect(body.link.sourceKind).toBe('twitter');
      expect(body.link.sourceData).toEqual(sourceData);
      expect(body.link.addedBy).toBe('user');

      const getRes = await app.request(`/api/links/${body.link.id}`);
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as { link: Record<string, unknown> };
      expect(getBody.link.sourceData).toEqual(sourceData);
    });

    it('re-ingesting the same tweet url -> deduped true, same id, sourceData still present (no duplicate row)', async () => {
      const { app, pool } = harness.mod();
      const url = 'https://x.com/dedupuser/status/9999999999999999999';
      const sourceData = ftTwitterSourceData();

      const first = await postJson(
        app,
        '/api/ingest',
        { url, sourceKind: 'twitter', sourceData },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { link: { id: string }; deduped: boolean };
      expect(firstBody.deduped).toBe(false);

      const second = await postJson(
        app,
        '/api/ingest',
        { url, sourceKind: 'twitter', sourceData },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(second.status).toBe(201);
      const secondBody = (await second.json()) as {
        link: { id: string; sourceData: unknown };
        deduped: boolean;
      };
      expect(secondBody.deduped).toBe(true);
      expect(secondBody.link.id).toBe(firstBody.link.id);
      expect(secondBody.link.sourceData).toEqual(sourceData);

      const countRes = await pool.query<{ count: string }>(
        'select count(*) from links where url = $1',
        [url],
      );
      expect(Number(countRes.rows[0]?.count ?? '0')).toBe(1);
    });

    it('ingest without sourceData (plain link) -> 201, works like a normal capture', async () => {
      const { app } = harness.mod();
      const res = await postJson(
        app,
        '/api/ingest',
        { url: 'https://example.com/ingest-plain-link' },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expect(body.link.sourceKind).toBe('link');
    });

    it('invalid sourceData (fails the twitter variant schema) -> 400 validation_error, nothing saved', async () => {
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(
        app,
        '/api/ingest',
        {
          url: 'https://x.com/bad/status/1',
          sourceKind: 'twitter',
          sourceData: { kind: 'twitter', text: 'missing required fields' },
        },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('validation_error');
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });

    it('bad url -> 400 invalid_url, nothing saved (same edge guard as POST /api/links)', async () => {
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(
        app,
        '/api/ingest',
        { url: 'javascript:alert(1)', sourceKind: 'twitter' },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('invalid_url');
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });
  });

  describe('regression — the public capture route never accepts sourceData', () => {
    it('POST /api/links with a sourceData field in the body -> saved as a plain link, sourceData ignored (no injection)', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/public-capture-sourcedata-attempt',
        sourceKind: 'link',
        sourceData: ftTwitterSourceData(),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown> };
      // The public route's schema has no `sourceData` field to bind to, so
      // the attempted payload is silently dropped by Zod's parse (unknown
      // key on a non-strict object schema), never reaching `core.createLink`.
      expect(body.link.sourceKind).toBe('link');
      expect(body.link.sourceData).toEqual({ kind: 'link' });
    });

    it('POST /api/links with sourceKind twitter + a sourceData field -> sourceKind is honored for routing, but sourceData is still ignored (stays the safe link floor)', async () => {
      const { app } = harness.mod();
      const res = await postJson(app, '/api/links', {
        url: 'https://example.com/public-capture-sourcedata-attempt-2',
        sourceKind: 'twitter',
        sourceData: ftTwitterSourceData(),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: Record<string, unknown> };
      expect(body.link.sourceKind).toBe('twitter');
      // No sourceData was ever bound from the request — createLink's
      // resolveSource falls back to the safe `{kind:'link'}` floor for a
      // rich sourceKind with no matching sourceData (see links.ts's doc
      // comment on resolveSource).
      expect(body.link.sourceData).toEqual({ kind: 'link' });
    });
  });
});
