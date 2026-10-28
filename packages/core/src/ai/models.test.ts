import { randomBytes } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type { AiConnectionResult } from './tester.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const FIRST = { id: 'accounts/fireworks/models/first', label: 'First', contextLength: 1000 };
const GLM = { id: 'accounts/fireworks/models/glm-5p3-flash', label: 'GLM', contextLength: 2000 };

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
    return models.refreshFireworksModels();
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
    await models.refreshFireworksModels();
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
    expect(await models.refreshFireworksModels()).toEqual({ ok: false, code: 'provider_error' });
    expect(await models.storedFireworksModels()).toEqual([FIRST, GLM]);
  });

  it('refreshes before key inference and uses GLM when listed, otherwise the first model', async () => {
    const { tester, models, providers } = harness.mod();
    await prepare();
    const calls: string[] = [];
    models.setAiModelsFetcher(async (key) => {
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
    expect((await providers.listAiProviders()).find((p) => p.kind === 'openai')).not.toHaveProperty(
      'models',
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
      expect(await models.refreshFireworksModels()).toEqual({ ok: false, code });
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
    await models.refreshFireworksModels();
    models.setAiModelsFetcher(async () => ({ ok: true, models: [] }));
    expect(await models.refreshFireworksModels()).toEqual({ ok: true, models: [] });
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
    expect(await models.refreshFireworksModels()).toEqual({ ok: false, code: 'unavailable' });
    expect((await providers.listAiProviders()).find((p) => p.kind === 'fireworks')).toMatchObject({
      models: [FIRST],
      modelsFetchedAt: new Date('2026-10-29T00:00:00Z'),
      modelsRefreshError: null,
    });
  });

  it('unavailable, malformed and thrown fetchers return fixed codes without leaking keys', async () => {
    const { models } = harness.mod();
    expect(await models.refreshFireworksModels()).toEqual({ ok: false, code: 'unavailable' });
    await prepare();
    models.setAiModelsFetcher(async () => {
      throw new Error('fake-fireworks-1234');
    });
    expect(await models.refreshFireworksModels()).toEqual({ ok: false, code: 'provider_error' });
    expect(await models.storedFireworksModels()).toEqual([FIRST, GLM]);
  });
});
