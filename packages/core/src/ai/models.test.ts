import { randomBytes } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type { AiLiveModel } from './model-types.js';
import type { AiConnectionResult } from './tester.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const FIRST: AiLiveModel = {
  id: 'accounts/fireworks/models/first',
  label: 'First',
  contextWindow: 1000,
  structuredOutput: 'native',
  reasoning: { type: 'fireworks' },
};
const GLM: AiLiveModel = {
  id: 'accounts/fireworks/models/glm-5p3-flash',
  label: 'GLM',
  contextWindow: 2000,
  structuredOutput: 'native',
  reasoning: { type: 'fireworks' },
};

describeIfPg('Fireworks live-list port and selection validation', () => {
  const harness = setupPgHarness('silo_ai_models', async () => ({
    models: await import('./models.js'),
    providers: await import('./providers.js'),
    settings: await import('../settings/settings.js'),
    tester: await import('./tester.js'),
    status: await import('./status.js'),
  }));
  let savedKey: string | undefined;
  beforeEach(async () => {
    savedKey = process.env.SILO_SECRET_KEY;
    process.env.SILO_SECRET_KEY = randomBytes(32).toString('base64');
    await harness.rawDb().execute(sql`TRUNCATE ai_providers, settings`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    harness.mod().models.setAiModelsFetcher(undefined);
    harness.mod().tester.setAiConnectionTester(undefined);
    if (savedKey === undefined) delete process.env.SILO_SECRET_KEY;
    else process.env.SILO_SECRET_KEY = savedKey;
  });
  const selection = (id: string) => ({
    enabled: true,
    features: { 'x-post-title': { enabled: true, model: { provider: 'fireworks', id } } },
  });
  const prepare = async () => {
    const { providers, models } = harness.mod();
    await providers.saveAiProviderKey('fireworks', 'fake-fireworks-1234');
    models.setAiModelsFetcher(async () => ({ ok: true, models: [FIRST, GLM] }));
    return models.refreshProviderModels('fireworks');
  };

  it('validates writes against the stored list and nulls removed models on reads', async () => {
    const { settings, status, models } = harness.mod();
    await expect(settings.setSetting('ai', selection(GLM.id))).rejects.toThrow();
    await prepare();
    await settings.setSetting('ai', selection(GLM.id));
    expect((await status.aiStatus()).features['x-post-title']).toMatchObject({
      ready: true,
      provider: 'fireworks',
      model: GLM.id,
    });
    expect(await status.resolveAiFeatureCredential('x-post-title')).toMatchObject({
      kind: 'fireworks',
      model: GLM,
    });
    await expect(
      settings.updateSettings({ theme: 'dark', ai: selection('unlisted') }),
    ).rejects.toThrow();
    expect(await settings.getSetting('theme')).toBe('system');
    models.setAiModelsFetcher(async () => ({ ok: true, models: [FIRST] }));
    await models.refreshProviderModels('fireworks');
    expect((await settings.getSetting('ai')).features['x-post-title'].model).toBeNull();
    expect((await settings.getAllSettings()).ai.features['x-post-title'].model).toBeNull();
    expect(await status.resolveAiFeatureCredential('x-post-title')).toBeUndefined();
  });

  it.each(['setSetting', 'updateSettings'] as const)(
    '%s waits for a concurrent list update and rejects a removed model',
    async (method) => {
      await prepare();
      const { settings } = harness.mod();
      let saving: Promise<unknown> | undefined;
      try {
        await harness.rawDb().transaction(async (tx) => {
          await tx.execute(
            sql`UPDATE ai_providers SET models = '[]'::jsonb WHERE kind = 'fireworks'`,
          );
          const write =
            method === 'setSetting'
              ? settings.setSetting('ai', selection(GLM.id))
              : settings.updateSettings({ theme: 'dark', ai: selection(GLM.id) });
          saving = write.then(
            () => null,
            (error: unknown) => error,
          );
          await waitForLock('%ai_providers%');
        });
      } finally {
        const error = await saving;
        expect(error).toMatchObject({ name: 'ZodError' });
      }
      expect(await settings.getSetting('theme')).toBe('system');
      expect((await settings.getSetting('ai')).enabled).toBe(false);
    },
  );

  it('holds the live-list lock until a standalone settings save commits', async () => {
    await prepare();
    const { settings } = harness.mod();
    await settings.setSetting('ai', selection(FIRST.id));
    let saving: Promise<unknown> | undefined;
    try {
      await expect(
        harness.rawDb().transaction(async (tx) => {
          await tx.execute(sql`SELECT key FROM settings WHERE key = 'ai' FOR UPDATE`);
          saving = settings.setSetting('ai', selection(GLM.id)).then(
            () => null,
            (error: unknown) => error,
          );
          await waitForLock('%insert into "settings"%');
          // A plain UPDATE takes NO KEY UPDATE, so FOR KEY SHARE would not suffice.
          await tx.execute(sql`SET LOCAL lock_timeout = '200ms'`);
          await tx.execute(
            sql`UPDATE ai_providers SET models = '[]'::jsonb WHERE kind = 'fireworks'`,
          );
        }),
      ).rejects.toMatchObject({ cause: { code: '55P03' } });
    } finally {
      expect(await saving).toBeNull();
    }
    expect((await settings.getSetting('ai')).features['x-post-title'].model?.id).toBe(GLM.id);
  });

  async function waitForLock(query: string): Promise<void> {
    await expect
      .poll(async () => {
        const result = await harness.rawDb().execute(sql`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE ${query}
      `);
        return result.rows.length;
      })
      .toBe(1);
  }

  it.each([
    { entries: Array.from({ length: 501 }, (_, i) => ({ ...FIRST, id: `model-${i}` })) },
    { entries: [{ ...FIRST, id: 'i'.repeat(513) }] },
    { entries: [{ ...FIRST, label: 'l'.repeat(257) }] },
  ])('rejects an oversized live list at the storage boundary (%#)', async ({ entries }) => {
    await prepare();
    const { models } = harness.mod();
    models.setAiModelsFetcher(async () => ({ ok: true, models: entries }));
    expect(await models.refreshProviderModels('fireworks')).toEqual({
      ok: false,
      code: 'provider_error',
    });
    expect(await models.storedProviderModels('fireworks')).toEqual([FIRST, GLM]);
  });

  it('refreshes before key inference and uses GLM when listed, otherwise the first model', async () => {
    const { tester, models, providers } = harness.mod();
    await prepare();
    const calls: string[] = [];
    models.setAiModelsFetcher(async (kind, key) => {
      expect(kind).toBe('fireworks');
      expect(key).toBe('fake-fireworks-1234');
      calls.push('list');
      return { ok: true, models: [FIRST, GLM] };
    });
    tester.setAiConnectionTester(async (credential) => {
      calls.push(credential.model.id);
      return { ok: true, latencyMs: 3 };
    });
    expect(await tester.testAiProvider('fireworks')).toMatchObject({ ok: true });
    expect(calls).toEqual(['list', GLM.id]);
    models.setAiModelsFetcher(async () => ({ ok: true, models: [FIRST] }));
    await tester.testAiProvider('fireworks');
    expect(calls.at(-1)).toBe(FIRST.id);
    const row = (await providers.listAiProviders()).find((p) => p.kind === 'fireworks');
    expect(row?.modelsFetchedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(row)).not.toContain('fake-fireworks-1234');
    expect((await providers.listAiProviders()).find((p) => p.kind === 'openai')?.models).toEqual(
      [],
    );
  });

  it('starts generation after a slow refresh and measures its latency separately', async () => {
    const { tester, models } = harness.mod();
    await prepare();
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      models.setAiModelsFetcher(async () => {
        now += 9_000;
        return { ok: true, models: [GLM] };
      });
      tester.setAiConnectionTester(async () => {
        now += 20_000;
        return { ok: true, latencyMs: Number.NaN };
      });
      // Total route time is 29 seconds; generation still has its own full budget.
      expect(await tester.testAiProvider('fireworks')).toEqual({ ok: true, latencyMs: 20_000 });
    } finally {
      clock.mockRestore();
    }
  });

  it.each(['timeout', 'network', 'provider_error', 'invalid_key'] as const)(
    'keeps the list and timestamp after %s and reports generation results',
    async (code) => {
      const { models, tester, providers, settings } = harness.mod();
      await prepare();
      await settings.setSetting('ai', selection(GLM.id));
      const before = (await providers.listAiProviders()).find((p) => p.kind === 'fireworks');
      models.setAiModelsFetcher(async () => ({ ok: false, code }));
      expect(await models.refreshProviderModels('fireworks')).toEqual({ ok: false, code });
      const after = (await providers.listAiProviders()).find((p) => p.kind === 'fireworks');
      expect(after).toMatchObject({
        models: [FIRST, GLM],
        modelsFetchedAt: before?.modelsFetchedAt,
        modelsRefreshError: code,
      });
      expect((await settings.getSetting('ai')).features['x-post-title'].model?.id).toBe(GLM.id);
      await settings.setSetting('ai', selection(GLM.id));
      const inference = vi.fn<() => Promise<AiConnectionResult>>(async () => ({
        ok: true,
        latencyMs: 7,
      }));
      tester.setAiConnectionTester(inference);
      expect(await tester.testAiProvider('fireworks')).toEqual({ ok: true, latencyMs: 7 });
      expect(inference).toHaveBeenCalledWith(expect.objectContaining({ model: GLM }));
      inference.mockResolvedValueOnce({ ok: false, code: 'quota', latencyMs: 9 });
      expect(await tester.testAiProvider('fireworks')).toEqual({
        ok: false,
        code: 'quota',
        latencyMs: 9,
      });
      expect(
        (await providers.listAiProviders()).find((p) => p.kind === 'fireworks')?.lastTest,
      ).toMatchObject({ ok: false, code: 'quota' });
    },
  );

  it.each(['invalid_key', 'timeout', 'network', 'provider_error'] as const)(
    'reports %s with no stored list and never runs inference',
    async (code) => {
      const { models, tester, providers } = harness.mod();
      await providers.saveAiProviderKey('fireworks', 'fake-fireworks-1234');
      models.setAiModelsFetcher(async () => ({ ok: false, code }));
      const inference = vi.fn();
      tester.setAiConnectionTester(inference);
      expect(await tester.testAiProvider('fireworks')).toMatchObject({ ok: false, code });
      expect(inference).not.toHaveBeenCalled();
      expect(
        (await providers.listAiProviders()).find((p) => p.kind === 'fireworks')?.lastTest,
      ).toMatchObject({ ok: false, code });
    },
  );

  it('replaces a good list with a successful empty list and clears its refresh error', async () => {
    const { models, providers } = harness.mod();
    await prepare();
    models.setAiModelsFetcher(async () => ({ ok: false, code: 'network' }));
    await models.refreshProviderModels('fireworks');
    models.setAiModelsFetcher(async () => ({ ok: true, models: [] }));
    expect(await models.refreshProviderModels('fireworks')).toEqual({ ok: true, models: [] });
    expect((await providers.listAiProviders()).find((p) => p.kind === 'fireworks')).toMatchObject({
      models: [],
      modelsFetchedAt: expect.any(Date),
      modelsRefreshError: null,
    });
  });

  it.each([true, false])('key replacement drops a stale refresh (success=%s)', async (ok) => {
    const { models, providers } = harness.mod();
    await prepare();
    models.setAiModelsFetcher(async () => {
      await providers.saveAiProviderKey('fireworks', 'replaced-key-5678');
      await harness.rawDb().execute(sql`
        UPDATE ai_providers SET models = ${JSON.stringify([FIRST])}::jsonb,
          models_fetched_at = '2026-10-29T00:00:00Z', models_refresh_error = NULL
        WHERE kind = 'fireworks'
      `);
      return ok ? { ok: true, models: [GLM] } : { ok: false, code: 'network' };
    });
    expect(await models.refreshProviderModels('fireworks')).toEqual({
      ok: false,
      code: 'unavailable',
    });
    expect((await providers.listAiProviders()).find((p) => p.kind === 'fireworks')).toMatchObject({
      models: [FIRST],
      modelsFetchedAt: new Date('2026-10-29T00:00:00Z'),
      modelsRefreshError: null,
    });
  });

  it('Save & test starts a new-key refresh while the old-key refresh is pending', async () => {
    const { models, providers, tester } = harness.mod();
    await providers.saveAiProviderKey('fireworks', 'old-key-1234');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (_kind: string, key: string) => {
      if (key === 'old-key-1234') {
        await blocked;
        return { ok: true as const, models: [FIRST] };
      }
      return { ok: true as const, models: [GLM] };
    });
    models.setAiModelsFetcher(fetcher);
    const old = models.refreshProviderModels('fireworks');
    await expect.poll(() => fetcher.mock.calls.length).toBe(1);
    try {
      await providers.saveAiProviderKey('fireworks', 'new-key-5678');
      const inference = vi.fn(async () => ({ ok: true as const, latencyMs: 1 }));
      tester.setAiConnectionTester(inference);
      expect(await tester.testAiProvider('fireworks')).toMatchObject({ ok: true });
      expect(fetcher.mock.calls.map(([, key]) => key)).toEqual(['old-key-1234', 'new-key-5678']);
      expect(inference).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'new-key-5678', model: GLM }),
      );
    } finally {
      release();
      expect(await old).toEqual({ ok: false, code: 'unavailable' });
    }
    expect(await models.storedProviderModels('fireworks')).toEqual([GLM]);
  });

  it('backs off automatic failures from 15 minutes to 6 hours, with manual and key-change resets', async () => {
    const { models, providers } = harness.mod();
    await providers.saveAiProviderKey('fireworks', 'backoff-key-1234');
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const reads = vi.spyOn(providers, 'readAiProviderKey');
    let release!: () => void;
    let blocked = Promise.resolve();
    const fetcher = vi.fn(async () => {
      await blocked;
      return { ok: false as const, code: 'network' as const };
    });
    models.setAiModelsFetcher(fetcher);
    const automatic = async () => {
      models.refreshStaleProviderModels(await providers.listAiProviders());
      await Promise.all(reads.mock.results.map((r) => r.value));
    };
    const failedRefresh = async () => {
      const count = fetcher.mock.calls.length;
      blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      await automatic();
      expect(fetcher).toHaveBeenCalledTimes(count + 1);
      const pending = models.refreshProviderModels('fireworks');
      // Join the same credential's pending refresh before allowing it to finish.
      await Promise.all(reads.mock.results.map((r) => r.value));
      release();
      expect(await pending).toEqual({ ok: false, code: 'network' });
    };
    for (const minutes of [15, 30, 60, 120, 240, 360, 360]) {
      await failedRefresh();
      const count = fetcher.mock.calls.length;
      now += minutes * 60_000 - 1;
      await automatic();
      expect(fetcher).toHaveBeenCalledTimes(count);
      now += 1;
    }
    // Manual refresh bypasses the outstanding delay and success clears it.
    await failedRefresh();
    models.setAiModelsFetcher(async () => ({ ok: true, models: [] }));
    expect(await models.refreshProviderModels('fireworks')).toEqual({ ok: true, models: [] });
    await harness.rawDb().execute(sql`UPDATE ai_providers SET models_fetched_at = NULL`);
    models.setAiModelsFetcher(fetcher);
    await failedRefresh();
    await providers.saveAiProviderKey('fireworks', 'replaced-backoff-key-5678');
    await failedRefresh();
  });

  it.each([
    ['claude-haiku-5-5', 'anthropic/claude-haiku-5.5'],
    ['claude-sonnet-5-5', 'anthropic/claude-sonnet-5.5'],
    ['claude-opus-5-5', 'anthropic/claude-opus-5.5'],
    ['claude-fable-5-1', 'anthropic/claude-fable-5.1'],
    ['gpt-6-luna', 'openai/gpt-6-luna'],
    ['gpt-6.1-terra', 'openai/gpt-6.1-terra'],
    ['gpt-6.1-sol', 'openai/gpt-6.1-sol'],
    ['gpt-6-astra', 'openai/gpt-6-astra'],
  ])(
    'migrates legacy Gateway selection %s on reads and persists it on write',
    async (legacy, id) => {
      const { settings, models, providers, status } = harness.mod();
      await providers.saveAiProviderKey('gateway', 'gateway-key-1234');
      models.setAiModelsFetcher(async () => ({
        ok: true,
        models: [{ ...FIRST, id, reasoning: { type: 'gateway' } }],
      }));
      await models.refreshProviderModels('gateway');
      const ai = {
        enabled: true,
        features: { 'x-post-title': { enabled: true, model: { provider: 'gateway', id: legacy } } },
      };
      await harness
        .rawDb()
        .execute(
          sql`INSERT INTO settings (key, value) VALUES ('ai', ${JSON.stringify(ai)}::jsonb)`,
        );
      const expected = { provider: 'gateway', id };
      expect((await settings.getSetting('ai')).features['x-post-title'].model).toEqual(expected);
      expect((await settings.getAllSettings()).ai.features['x-post-title'].model).toEqual(expected);
      expect((await settings.getAiSettingForStatus()).features['x-post-title'].model).toEqual(
        expected,
      );
      expect(await status.resolveAiFeatureCredential('x-post-title')).toMatchObject({
        model: { id },
      });
      await settings.setSetting('ai', ai);
      const stored = await harness
        .rawDb()
        .execute(sql`SELECT value FROM settings WHERE key = 'ai'`);
      expect(stored.rows[0]?.value).toMatchObject({
        features: { 'x-post-title': { model: expected } },
      });
    },
  );

  it.each([
    ['anthropic', 'claude-haiku-5-5'],
    ['openai', 'gpt-6-luna'],
  ] as const)('keeps direct %s ids unchanged on reads and writes', async (kind, id) => {
    const { providers, models, settings } = harness.mod();
    await providers.saveAiProviderKey(kind, 'direct-key-1234');
    models.setAiModelsFetcher(async () => ({
      ok: true,
      models: [{ ...FIRST, id, reasoning: { type: kind } }],
    }));
    await models.refreshProviderModels(kind);
    await settings.updateSettings({
      ai: {
        enabled: true,
        features: { 'x-post-title': { enabled: true, model: { provider: kind, id } } },
      },
    });
    expect((await settings.getSetting('ai')).features['x-post-title'].model).toEqual({
      provider: kind,
      id,
    });
  });

  it('unavailable, malformed and thrown fetchers return fixed codes without leaking keys', async () => {
    const { models } = harness.mod();
    expect(await models.refreshProviderModels('fireworks')).toEqual({
      ok: false,
      code: 'unavailable',
    });
    await prepare();
    models.setAiModelsFetcher(async () => {
      throw new Error('fake-fireworks-1234');
    });
    expect(await models.refreshProviderModels('fireworks')).toEqual({
      ok: false,
      code: 'provider_error',
    });
    expect(await models.storedProviderModels('fireworks')).toEqual([FIRST, GLM]);
  });
  it.each(['anthropic', 'openai', 'gateway', 'fireworks'] as const)(
    '%s stores, validates, and preserves a failed refresh',
    async (kind) => {
      const { providers, models, settings } = harness.mod();
      await providers.saveAiProviderKey(kind, 'provider-key-1234');
      const live: AiLiveModel = {
        id: 'future-model',
        label: 'Future',
        structuredOutput: 'unknown',
        reasoning: { type: kind },
      };
      models.setAiModelsFetcher(async (requested, key) => {
        expect(requested).toBe(kind);
        expect(key).toBe('provider-key-1234');
        return { ok: true, models: [live] };
      });
      await models.refreshProviderModels(kind);
      const ai = {
        enabled: true,
        features: { 'x-post-title': { enabled: true, model: { provider: kind, id: live.id } } },
      };
      await settings.setSetting('ai', ai);
      expect(await settings.getSetting('ai')).toEqual(ai);
      const before = (await providers.listAiProviders()).find((p) => p.kind === kind);
      models.setAiModelsFetcher(async () => ({ ok: false, code: 'network' }));
      await models.refreshProviderModels(kind);
      expect((await providers.listAiProviders()).find((p) => p.kind === kind)).toMatchObject({
        models: [live],
        modelsFetchedAt: before?.modelsFetchedAt,
        modelsRefreshError: 'network',
      });
      await expect(
        settings.setSetting('ai', {
          ...ai,
          features: {
            'x-post-title': { enabled: true, model: { provider: kind, id: 'unlisted' } },
          },
        }),
      ).rejects.toThrow();
    },
  );

  it('refreshes stale lists in the background once per provider and never blocks the caller', async () => {
    const { providers, models } = harness.mod();
    await providers.saveAiProviderKey('anthropic', 'anthropic-key-1234');
    await providers.saveAiProviderKey('openai', 'openai-key-1234');
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    models.setAiModelsFetcher(async (kind) => {
      seen.push(kind);
      await blocked;
      return { ok: true, models: [] };
    });
    const snapshot = await providers.listAiProviders();
    expect(models.refreshStaleProviderModels(snapshot)).toBeUndefined();
    models.refreshStaleProviderModels(snapshot);
    await expect.poll(() => seen.length).toBe(2);
    expect(seen.sort()).toEqual(['anthropic', 'openai']);
    const refreshes = [
      models.refreshProviderModels('anthropic'),
      models.refreshProviderModels('openai'),
    ];
    release?.();
    await Promise.all(refreshes);
    models.refreshStaleProviderModels(await providers.listAiProviders());
    expect(seen).toHaveLength(2);
    await harness
      .rawDb()
      .execute(
        sql`UPDATE ai_providers SET models_fetched_at = NOW() - INTERVAL '25 hours' WHERE kind = 'anthropic'`,
      );
    models.refreshStaleProviderModels(await providers.listAiProviders());
    await models.refreshProviderModels('anthropic');
    expect(seen).toHaveLength(3);
  });

  it('upgrades an existing Fireworks cache in place without a database migration', async () => {
    const { providers, models } = harness.mod();
    await providers.saveAiProviderKey('fireworks', 'fireworks-key-1234');
    await harness
      .rawDb()
      .execute(
        sql`UPDATE ai_providers SET models = '[{"id":"old-cache","label":"Cached","contextLength":1000}]'::jsonb WHERE kind = 'fireworks'`,
      );
    expect(await models.storedProviderModels('fireworks')).toEqual([
      {
        id: 'old-cache',
        label: 'Cached',
        contextWindow: 1000,
        structuredOutput: 'native',
        reasoning: { type: 'fireworks' },
      },
    ]);
  });
});
