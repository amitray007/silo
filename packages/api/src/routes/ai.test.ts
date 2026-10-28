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
    const { setAiConnectionTester, setAiModelsFetcher } = await import('@silo/core/ai-credential');
    setAiConnectionTester(async () => tester());
    setAiModelsFetcher(async (kind) => ({
      ok: true,
      models: [
        {
          id:
            kind === 'anthropic'
              ? 'claude-haiku-5-5'
              : kind === 'openai'
                ? 'gpt-6-luna'
                : 'anthropic/claude-haiku-5.5',
          label: 'Live model',
          structuredOutput: 'native',
          reasoning: kind === 'fireworks' ? { type: 'fireworks' } : { type: kind },
        },
      ],
    }));
    const { createApp } = await import('../app.js');
    return { core, app: createApp(), setAiModelsFetcher };
  });

  const clearEnv = () => {
    delete process.env.SILO_API_TOKEN;
    delete process.env.SILO_APP_PASSWORD;
    process.env.SILO_SECRET_KEY = SECRET_KEY;
  };
  beforeEach(clearEnv);
  beforeEach(() => {
    harness.mod().setAiModelsFetcher(async (kind) => ({
      ok: true,
      models: [
        {
          id:
            kind === 'anthropic'
              ? 'claude-haiku-5-5'
              : kind === 'openai'
                ? 'gpt-6-luna'
                : 'anthropic/claude-haiku-5.5',
          label: 'Live model',
          structuredOutput: 'native',
          reasoning: { type: kind },
        },
      ],
    }));
    tester = okTester;
  });
  afterEach(async () => {
    clearEnv();
    const { core } = harness.mod();
    for (const kind of core.AI_PROVIDER_KINDS) await core.removeAiProvider(kind);
    await core.updateSettings({
      theme: 'system',
      ai: { enabled: false, features: { 'x-post-title': { enabled: false, model: null } } },
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
    expect(body.status).toMatchObject({
      enabled: false,
      secretKey: 'ok',
      features: { 'x-post-title': { ready: false } },
    });
    expect(body.providers).toEqual(
      ['anthropic', 'openai', 'gateway', 'fireworks'].map((kind) => ({
        kind,
        configured: false,
        keyLast4: null,
        keyReadable: true,
        lastTest: null,
        models: [],
        defaultModel: null,
        modelsFetchedAt: null,
        modelsRefreshError: null,
      })),
    );
    expect(body.features).toEqual([
      {
        id: 'x-post-title',
        label: 'AI titles',
        description: 'Short titles written by your AI model',
        plugin: 'twitter',
      },
    ]);
    expect(body).not.toHaveProperty('catalog');
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
    await putKey('anthropic', API_KEY);
    await core.updateSettings({
      ai: {
        enabled: true,
        features: {
          'x-post-title': {
            enabled: false,
            model: { provider: 'anthropic', id: 'claude-haiku-5-5' },
          },
        },
      },
    });
    const res = await app.request('/api/ai/providers/anthropic', { method: 'DELETE' });
    expect(res.status).toBe(204);
    const body = (await (await app.request('/api/ai')).json()) as {
      providers: Array<Record<string, unknown>>;
      status: { features: { 'x-post-title': { provider: string | null } } };
    };
    expect(body.providers[0]).toMatchObject({ kind: 'anthropic', configured: false });
    expect(body.status.features['x-post-title'].provider).toBeNull();
    expect((await core.getAllSettings()).ai.features['x-post-title'].model).toBeNull();
    await core.updateSettings({
      ai: { enabled: false, features: { 'x-post-title': { enabled: false, model: null } } },
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
          features: {
            'x-post-title': { enabled: false, model: { provider: 'anthropic', id: 'gpt-6-astra' } },
          },
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
        features: { 'x-post-title': { enabled: false, model: null } },
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
            features: { 'x-post-title': { enabled: false, model: null } },
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
  it('refreshes Fireworks through the protected port and returns only its public list', async () => {
    const { setAiModelsFetcher } = await import('@silo/core/ai-credential');
    const { app, core } = harness.mod();
    const model = {
      id: 'accounts/fireworks/models/glm-5p3-flash',
      label: 'GLM',
      contextWindow: 200000,
      structuredOutput: 'native' as const,
      reasoning: { type: 'fireworks' as const },
    };
    setAiModelsFetcher(async () => ({ ok: true, models: [model] }));
    try {
      const saved = await putKey('fireworks', API_KEY);
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({
        test: { ok: true },
        provider: { models: [model], modelsFetchedAt: expect.any(String) },
      });
      const refreshed = await app.request('/api/ai/providers/fireworks/models/refresh', {
        method: 'POST',
      });
      expect(refreshed.status).toBe(200);
      expect(await refreshed.json()).toEqual({ ok: true, models: [model] });
      const response = await app.request('/api/ai');
      const text = await response.text();
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain('encrypted');
      const body = JSON.parse(text);
      expect(body.providers.find((p: { kind: string }) => p.kind === 'fireworks').models).toEqual([
        model,
      ]);
      expect(body.providers.find((p: { kind: string }) => p.kind === 'anthropic')).toHaveProperty(
        'models',
      );
      const ai = {
        enabled: true,
        features: {
          'x-post-title': { enabled: true, model: { provider: 'fireworks', id: model.id } },
        },
      };
      expect(
        (
          await app.request('/api/settings', {
            method: 'PATCH',
            headers: json,
            body: JSON.stringify({ ai }),
          })
        ).status,
      ).toBe(200);
      const fetchedAt = body.providers.find(
        (p: { kind: string }) => p.kind === 'fireworks',
      ).modelsFetchedAt;
      setAiModelsFetcher(async () => ({ ok: false, code: 'timeout' }));
      const failed = await app.request('/api/ai/providers/fireworks/models/refresh', {
        method: 'POST',
      });
      expect(failed.status).toBe(502);
      expect(await failed.json()).toMatchObject({ error: 'timeout' });
      const stale = JSON.parse(await (await app.request('/api/ai')).text());
      expect(stale.providers.find((p: { kind: string }) => p.kind === 'fireworks')).toMatchObject({
        models: [model],
        modelsFetchedAt: fetchedAt,
        modelsRefreshError: 'timeout',
      });
      expect((await core.getAllSettings()).ai.features['x-post-title'].model?.id).toBe(model.id);
      expect(
        (
          await app.request('/api/settings', {
            method: 'PATCH',
            headers: json,
            body: JSON.stringify({ ai }),
          })
        ).status,
      ).toBe(200);
      ai.features['x-post-title'].model.id = 'unlisted';
      expect(
        (
          await app.request('/api/settings', {
            method: 'PATCH',
            headers: json,
            body: JSON.stringify({ ai }),
          })
        ).status,
      ).toBe(400);
      expect((await core.getAllSettings()).ai.features['x-post-title'].model?.id).toBe(model.id);
      const token = await core.generateAccessToken('fireworks refresh test');
      process.env.SILO_API_TOKEN = ENV_TOKEN;
      expect(
        (
          await app.request('/api/ai/providers/fireworks/models/refresh', {
            method: 'POST',
            headers: bearer(token.token),
          })
        ).status,
      ).toBe(403);
    } finally {
      setAiModelsFetcher(undefined);
    }
  });
  it.each(['anthropic', 'openai', 'gateway', 'fireworks'] as const)(
    'refreshes %s through the operator-only route',
    async (kind) => {
      await putKey(kind, API_KEY);
      const { app, core } = harness.mod();
      const result = await app.request(`/api/ai/providers/${kind}/models/refresh`, {
        method: 'POST',
      });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        ok: true,
        models: [{ reasoning: { type: kind } }],
      });
      const token = await core.generateAccessToken('refresh guard');
      process.env.SILO_API_TOKEN = ENV_TOKEN;
      const denied = await app.request(`/api/ai/providers/${kind}/models/refresh`, {
        method: 'POST',
        headers: bearer(token.token),
      });
      expect(denied.status).toBe(403);
    },
  );
  it('GET returns its stored snapshot while a deduplicated background refresh is pending', async () => {
    const { app, core, setAiModelsFetcher } = harness.mod();
    await core.saveAiProviderKey('anthropic', API_KEY);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    setAiModelsFetcher(async () => {
      requests += 1;
      await blocked;
      return { ok: true, models: [] };
    });
    try {
      const first = await app.request('/api/ai');
      const second = await app.request('/api/ai');
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const body = (await first.json()) as {
        providers: { models: unknown[]; modelsFetchedAt: string | null }[];
      };
      expect(body.providers[0]).toMatchObject({
        models: [],
        modelsFetchedAt: null,
      });
      await expect.poll(() => requests).toBe(1);
    } finally {
      release?.();
      await core.refreshProviderModels('anthropic');
    }
  });
});
