import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `POST /api/import` (import method file,
 * U2) — driven via Hono's `app.request(...)` against a real Postgres,
 * mirroring `routes/ingest.test.ts`'s `describeIfPg`/`setupPgHarness`
 * structure exactly (dedup/merge classification is a database behavior mocks
 * can't prove — `docs/rules/testing.md`). Covers the token gate (shared with
 * `/api/ingest` via `checkIngestAuth`), bad-JSON/bad-envelope 400s, and the
 * created/merged/skipped counting contract against `core.importLinks`.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const TEST_TOKEN = 'test-import-token-do-not-use-in-prod';

/** POSTs a raw string `body` (already-serialized, so a deliberately-malformed
 * JSON string can be sent) to `path` on `app`, optionally with an
 * `Authorization` header — mirrors `ingest.test.ts`'s `postJson` but takes
 * the body pre-stringified since the bad-JSON test needs to send a string
 * `JSON.stringify` would never itself produce. */
async function postRaw(
  app: Hono,
  path: string,
  body: string,
  authorization?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  return app.request(path, { method: 'POST', headers, body });
}

/** POSTs a JSON-serializable `body` to `path` on `app`. */
async function postJson(
  app: Hono,
  path: string,
  body: unknown,
  authorization?: string,
): Promise<Response> {
  return postRaw(app, path, JSON.stringify(body), authorization);
}

describeIfPg('POST /api/import (integration)', () => {
  const harness = setupPgHarness('silo_api_import_test', async () => {
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
    it('no Authorization header -> 401 unauthorized, nothing imported', async () => {
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(app, '/api/import', {
        version: 1,
        links: [{ url: 'https://example.com/no-auth-import', sourceKind: 'link' }],
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('unauthorized');
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });

    it('SILO_API_TOKEN unset on the process -> 401 even with a well-formed Bearer header (never falls open)', async () => {
      delete process.env.SILO_API_TOKEN;
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(
        app,
        '/api/import',
        { version: 1, links: [] },
        'Bearer anything-at-all',
      );
      expect(res.status).toBe(401);
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });
  });

  describe('trusted caller — validation', () => {
    it('correct token, bad JSON body -> 400 validation_error, nothing imported', async () => {
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postRaw(app, '/api/import', '{not valid json', `Bearer ${TEST_TOKEN}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('validation_error');
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });

    it('correct token, version: 2 envelope -> 400 validation_error, nothing imported', async () => {
      const { app, pool } = harness.mod();
      const before = (await pool.query('select count(*) from links')).rows[0]?.count;
      const res = await postJson(
        app,
        '/api/import',
        { version: 2, links: [] },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('validation_error');
      const after = (await pool.query('select count(*) from links')).rows[0]?.count;
      expect(after).toBe(before);
    });
  });

  describe('trusted caller — happy path', () => {
    it('valid version:1 file -> 200 with correct created/merged/skipped counts', async () => {
      const { app, core } = harness.mod();

      // Seed one link that the import payload will re-import (-> merged).
      const seeded = await core.createLink({
        url: 'https://example.com/already-in-store',
        sourceKind: 'link',
      });
      expect(seeded).toBeTruthy();

      const res = await postJson(
        app,
        '/api/import',
        {
          version: 1,
          links: [
            { url: 'https://example.com/already-in-store', sourceKind: 'link' },
            { url: 'https://example.com/brand-new-import', sourceKind: 'link' },
          ],
        },
        `Bearer ${TEST_TOKEN}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as CoreOps.ImportResult;
      expect(body.version).toBe(1);
      expect(body.total).toBe(2);
      expect(body.created).toBe(1);
      expect(body.merged).toBe(1);
      expect(body.skipped).toEqual([]);
    });
  });
});
