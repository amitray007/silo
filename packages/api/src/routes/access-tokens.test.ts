import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for the access-token MANAGEMENT routes
 * (`GET`/`POST`/`DELETE /api/access-tokens`, access-tokens slice U3) — driven
 * via `createApp()` + `app.request(...)` against a real disposable Postgres
 * (mirrors `tags.test.ts`/`settings.test.ts`). ONE `setupPgHarness` for the
 * whole file — same rationale as those files (the `@silo/db` pool singleton).
 *
 * `SILO_API_TOKEN` is set/restored around the gating tests exactly like
 * `general-auth.test.ts` (`beforeEach`/`afterEach` delete — CRITICAL to
 * restore so a leaked value can't bleed into other test files).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const TOKEN = 'access-tokens-route-test-token-do-not-use-in-prod';

type CreatedTokenResponse = {
  id: string;
  name: string;
  token: string;
  prefix: string;
  createdAt: string;
};

type ListResponse = { tokens: Array<Record<string, unknown>> };

/** POSTs `{ name }` to `/api/access-tokens` with the auth header this file's tests use — the shared shape behind every create call. */
async function createToken(app: Hono, name: string): Promise<Response> {
  return app.request('/api/access-tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ name }),
  });
}

describeIfPg('access-token management routes (integration, access-tokens slice U3)', () => {
  const harness = setupPgHarness('silo_api_access_tokens_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  beforeEach(() => {
    delete process.env.SILO_API_TOKEN;
  });

  afterEach(() => {
    delete process.env.SILO_API_TOKEN;
  });

  describe('gating: all three routes require a bearer when SILO_API_TOKEN is set', () => {
    it('GET /api/access-tokens without a bearer is 401', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/access-tokens');
      expect(res.status).toBe(401);
    });

    it('POST /api/access-tokens without a bearer is 401', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/access-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'no-auth' }),
      });
      expect(res.status).toBe(401);
    });

    it('DELETE /api/access-tokens/:id without a bearer is 401', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/access-tokens/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('create + list + revoke happy path', () => {
    it('POST creates a token: 201, raw token starts with silo_, and id/name/prefix/createdAt are present', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await createToken(app, 'laptop');
      expect(res.status).toBe(201);
      const body = (await res.json()) as CreatedTokenResponse;
      expect(body.name).toBe('laptop');
      expect(typeof body.id).toBe('string');
      expect(typeof body.token).toBe('string');
      expect(body.token.startsWith('silo_')).toBe(true);
      expect(typeof body.prefix).toBe('string');
      expect(body.token.startsWith(body.prefix)).toBe(true);
      expect(typeof body.createdAt).toBe('string');
    });

    it('GET lists the created token by name/prefix, with NO token/hash field anywhere in the response (no-secret-leak)', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const created = (await (
        await createToken(app, 'list-test-token')
      ).json()) as CreatedTokenResponse;

      const res = await app.request('/api/access-tokens', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListResponse;

      const entry = body.tokens.find((t) => t.id === created.id);
      expect(entry).toBeDefined();
      expect(entry?.name).toBe('list-test-token');
      expect(entry?.prefix).toBe(created.prefix);

      // No entry anywhere in the list carries the raw token or a hash field —
      // asserted across the whole response body, not just this one entry.
      const serialized = JSON.stringify(body);
      expect(serialized.includes(created.token)).toBe(false);
      for (const t of body.tokens) {
        expect(Object.hasOwn(t, 'token')).toBe(false);
        expect(Object.hasOwn(t, 'hash')).toBe(false);
        expect(Object.hasOwn(t, 'tokenHash')).toBe(false);
      }
    });

    it('DELETE the created id: 204, then GET no longer lists it', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const created = (await (await createToken(app, 'revoke-me')).json()) as CreatedTokenResponse;

      const delRes = await app.request(`/api/access-tokens/${created.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/api/access-tokens', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      const body = (await listRes.json()) as ListResponse;
      expect(body.tokens.find((t) => t.id === created.id)).toBeUndefined();
    });

    it('DELETE a random (well-formed) uuid that does not exist is 404', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/access-tokens/7e732c76-5ca9-4d57-9a94-58ce15ec7805', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('not_found');
    });

    it('DELETE a non-uuid id is 400', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/access-tokens/not-a-uuid', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('validation', () => {
    it('POST with an empty name is 400', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await createToken(app, '');
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('validation_error');
    });

    it('POST with a missing name field is 400', async () => {
      process.env.SILO_API_TOKEN = TOKEN;
      const { app } = harness.mod();
      const res = await app.request('/api/access-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error).toBe('validation_error');
    });
  });
});
