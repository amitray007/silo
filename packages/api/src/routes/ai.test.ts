import { randomBytes } from 'node:crypto';
import type * as CoreOps from '@silo/core';
import type { AiConnectionTester } from '@silo/core/ai-credential';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level tests for `/api/ai/*` against a real disposable Postgres. The
 * connection tester is a stub; nothing touches the network.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const ENV_TOKEN = 'ai-routes-test-env-token-do-not-use-in-prod';
const PASSWORD = 'ai-routes-test-password';
const API_KEY = 'sk-test-AAAA-secret-key-1234';
const SECRET_KEY = randomBytes(32).toString('base64');

type TesterResult = Awaited<ReturnType<AiConnectionTester>>;
const okTester = async (): Promise<TesterResult> => ({ ok: true, latencyMs: 12 });
let tester: () => Promise<TesterResult> = okTester;

const json = { 'content-type': 'application/json' };
const bearer = (token: string) => ({ ...json, Authorization: `Bearer ${token}` });

describeIfPg('/api/ai routes (integration)', () => {
  const harness = setupPgHarness('silo_api_ai_test', async () => {
    process.env.SILO_SECRET_KEY = SECRET_KEY;
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { setAiConnectionTester } = await import('@silo/core/ai-credential');
    setAiConnectionTester(async () => tester());
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  const clearEnv = () => {
    delete process.env.SILO_API_TOKEN;
    delete process.env.SILO_APP_PASSWORD;
    process.env.SILO_SECRET_KEY = SECRET_KEY;
  };
  beforeEach(clearEnv);
  beforeEach(() => {
    tester = okTester;
  });
  afterEach(async () => {
    clearEnv();
    const { core } = harness.mod();
    for (const kind of core.AI_PROVIDER_KINDS) await core.removeAiProvider(kind);
    await core.updateSettings({
      theme: 'system',
      ai: { enabled: false, provider: null, model: null, features: { 'x-post-title': false } },
    });
  });

  const putKey = (kind: string, apiKey: unknown, headers: Record<string, string> = json) =>
    harness.mod().app.request(`/api/ai/providers/${kind}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ apiKey }),
    });

  it('GET on a fresh database has the contract shape and no secrets', async () => {
    const res = await harness.mod().app.request('/api/ai');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('v1.');
    expect(text).not.toContain('encrypted');
    const body = JSON.parse(text);
    expect(body.status).toMatchObject({ enabled: false, secretKey: 'ok', ready: false });
    expect(body.providers).toEqual([
      { kind: 'anthropic', configured: false, keyLast4: null, keyReadable: true, lastTest: null },
      { kind: 'openai', configured: false, keyLast4: null, keyReadable: true, lastTest: null },
      { kind: 'gateway', configured: false, keyLast4: null, keyReadable: true, lastTest: null },
    ]);
    expect(body.features).toEqual([
      {
        id: 'x-post-title',
        label: 'AI titles',
        description: 'Short titles written by your AI model',
        plugin: 'twitter',
      },
    ]);
    const haiku = body.catalog.find((m: { id: string }) => m.id === 'claude-haiku-5-5');
    expect(haiku).toEqual({
      id: 'claude-haiku-5-5',
      family: 'claude',
      label: 'Claude Haiku 5.5',
      tier: 'fast',
      providers: ['anthropic', 'gateway'],
      defaultFor: ['anthropic', 'gateway'],
    });
    const gpt = body.catalog.find((m: { id: string }) => m.id === 'gpt-6-astra');
    expect(gpt.providers).toEqual(['openai', 'gateway']);
    expect(gpt.defaultFor).toEqual([]);
  });

  it('PUT saves, tests, and never echoes the key; GET stays key-free', async () => {
    const res = await putKey('anthropic', API_KEY);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('v1.');
    const body = JSON.parse(text);
    expect(body.test).toEqual({ ok: true, latencyMs: expect.any(Number) });
    expect(body.provider).toMatchObject({
      kind: 'anthropic',
      configured: true,
      keyLast4: API_KEY.slice(-4),
      keyReadable: true,
      lastTest: { ok: true, code: null },
    });
    expect(Number.isNaN(Date.parse(body.provider.lastTest.at))).toBe(false);

    const get = await (await harness.mod().app.request('/api/ai')).text();
    expect(get).not.toContain(API_KEY);
    expect(get).not.toContain('v1.');
    expect(JSON.parse(get).providers[0].configured).toBe(true);
  });

  it('PUT with a too-short key is 400 and does not echo the input', async () => {
    const res = await putKey('openai', 'short-1');
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('short-1');
    expect(JSON.parse(text)).toEqual({
      error: 'invalid_api_key',
      message: 'API key must be 8-300 printable ASCII characters.',
    });
    expect((await putKey('openai', 12345678)).status).toBe(400);
  });

  it('PUT without SILO_SECRET_KEY is 409', async () => {
    delete process.env.SILO_SECRET_KEY;
    const res = await putKey('openai', API_KEY);
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).not.toContain(API_KEY);
    expect(JSON.parse(text).error).toBe('secret_key_missing');
  });

  it('POST test runs the tester; unavailable passes through as a code', async () => {
    await harness.mod().core.saveAiProviderKey('anthropic', API_KEY);
    const ok = await harness.mod().app.request('/api/ai/providers/anthropic/test', {
      method: 'POST',
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, latencyMs: expect.any(Number) });
    const none = await harness.mod().app.request('/api/ai/providers/gateway/test', {
      method: 'POST',
    });
    expect(await none.json()).toEqual({ ok: false, code: 'unavailable' });
  });

  it('DELETE removes the key and clears ai.provider when it pointed there', async () => {
    const { core, app } = harness.mod();
    await core.updateSettings({
      ai: {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        features: { 'x-post-title': false },
      },
    });
    const res = await app.request('/api/ai/providers/anthropic', { method: 'DELETE' });
    expect(res.status).toBe(204);
    const body = (await (await app.request('/api/ai')).json()) as {
      providers: Array<Record<string, unknown>>;
      status: { provider: string | null };
    };
    expect(body.providers[0]).toMatchObject({ kind: 'anthropic', configured: false });
    expect(body.status.provider).toBeNull();
    expect((await core.getAllSettings()).ai.model).toBeNull();
    await core.updateSettings({
      ai: { enabled: false, provider: null, model: null, features: { 'x-post-title': false } },
    });
  });

  it.each([
    [
      'a failing result',
      async (): Promise<TesterResult> => ({ ok: false, code: 'invalid_key', latencyMs: 5 }),
      'invalid_key',
    ],
    [
      'a throwing tester',
      async (): Promise<TesterResult> => {
        throw new Error(`boom ${API_KEY}`);
      },
      'provider_error',
    ],
  ])('PUT and POST report %s as a code without echoing the key', async (_name, next, code) => {
    tester = next;
    const put = await putKey('anthropic', API_KEY);
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(API_KEY);
    const putBody = JSON.parse(putText);
    expect(putBody.test).toMatchObject({ ok: false, code });
    expect(putBody.provider.lastTest).toMatchObject({ ok: false, code });

    const post = await harness.mod().app.request('/api/ai/providers/anthropic/test', {
      method: 'POST',
    });
    const postText = await post.text();
    expect(postText).not.toContain(API_KEY);
    expect(JSON.parse(postText)).toMatchObject({ ok: false, code });
    const get = (await (await harness.mod().app.request('/api/ai')).json()) as {
      providers: Array<{ lastTest: unknown }>;
    };
    expect(get.providers[0]?.lastTest).toMatchObject({ ok: false, code });
  });

  it('keyReadable is false once SILO_SECRET_KEY rotates without a previous key', async () => {
    await putKey('openai', API_KEY);
    process.env.SILO_SECRET_KEY = randomBytes(32).toString('base64');
    const text = await (await harness.mod().app.request('/api/ai')).text();
    expect(text).not.toContain(API_KEY);
    const body = JSON.parse(text);
    expect(body.providers[1]).toMatchObject({
      kind: 'openai',
      configured: true,
      keyReadable: false,
    });
  });

  it('PATCH /api/settings with an unreachable ai.model is 400 validation_error', async () => {
    const res = await harness.mod().app.request('/api/settings', {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({
        ai: {
          enabled: true,
          provider: 'anthropic',
          model: 'gpt-6-astra',
          features: { 'x-post-title': false },
        },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('validation_error');
  });

  it('an unknown kind is 400', async () => {
    const { app } = harness.mod();
    expect((await putKey('nope', API_KEY)).status).toBe(400);
    expect((await app.request('/api/ai/providers/nope', { method: 'DELETE' })).status).toBe(400);
    expect((await app.request('/api/ai/providers/nope/test', { method: 'POST' })).status).toBe(400);
  });

  describe('operator-only', () => {
    it('a named DB token gets 403 on writes but may read and patch non-AI settings', async () => {
      process.env.SILO_API_TOKEN = ENV_TOKEN;
      const { core, app } = harness.mod();
      const { token } = await core.generateAccessToken('ai-routes-test');
      const h = bearer(token);
      const denied = {
        error: 'operator_only',
        message: 'Only the web session or the operator token can change AI settings.',
      };

      const put = await putKey('openai', API_KEY, h);
      expect(put.status).toBe(403);
      expect(await put.json()).toEqual(denied);
      expect(
        (await app.request('/api/ai/providers/openai', { method: 'DELETE', headers: h })).status,
      ).toBe(403);
      expect(
        (await app.request('/api/ai/providers/openai/test', { method: 'POST', headers: h })).status,
      ).toBe(403);
      const ai = {
        enabled: true,
        provider: null,
        model: null,
        features: { 'x-post-title': false },
      };
      const patchAi = await app.request('/api/settings', {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ ai }),
      });
      expect(patchAi.status).toBe(403);
      expect((await core.getAllSettings()).ai.enabled).toBe(false);

      const patchTheme = await app.request('/api/settings', {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ theme: 'dark' }),
      });
      expect(patchTheme.status).toBe(200);
      expect((await app.request('/api/ai', { headers: h })).status).toBe(200);
    });

    it('the env token may change AI settings', async () => {
      process.env.SILO_API_TOKEN = ENV_TOKEN;
      const { app } = harness.mod();
      const h = bearer(ENV_TOKEN);
      expect((await putKey('gateway', API_KEY, h)).status).toBe(200);
      const patch = await app.request('/api/settings', {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({
          ai: {
            enabled: false,
            provider: 'gateway',
            model: null,
            features: { 'x-post-title': false },
          },
        }),
      });
      expect(patch.status).toBe(200);
      expect(
        (await app.request('/api/ai/providers/gateway', { method: 'DELETE', headers: h })).status,
      ).toBe(204);
    });

    it('a session cookie needs the CSRF header on writes', async () => {
      process.env.SILO_APP_PASSWORD = PASSWORD;
      const { app } = harness.mod();
      const login = await app.request('/api/login', {
        method: 'POST',
        headers: { ...json, 'X-Silo-CSRF': '1' },
        body: JSON.stringify({ password: PASSWORD }),
      });
      const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';

      const noCsrf = await putKey('openai', API_KEY, { ...json, Cookie: cookie });
      expect(noCsrf.status).toBe(403);
      expect(((await noCsrf.json()) as { error: string }).error).toBe('csrf_required');

      const withCsrf = await putKey('openai', API_KEY, {
        ...json,
        Cookie: cookie,
        'X-Silo-CSRF': '1',
      });
      expect(withCsrf.status).toBe(200);

      const del = await app.request('/api/ai/providers/openai', {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      expect(del.status).toBe(403);
      expect(((await del.json()) as { error: string }).error).toBe('csrf_required');
    });
  });
});
