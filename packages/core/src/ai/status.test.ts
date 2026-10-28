import { randomBytes } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const FAKE_KEY = 'sk-test-0000000000000000';

describeIfPg('per-feature AI readiness and credentials', () => {
  const harness = setupPgHarness('silo_core_ai_status_test', async () => ({
    status: await import('./status.js'),
    providers: await import('./providers.js'),
    settings: await import('../settings/settings.js'),
  }));
  let savedKey: string | undefined;
  beforeEach(async () => {
    savedKey = process.env.SILO_SECRET_KEY;
    process.env.SILO_SECRET_KEY = randomBytes(32).toString('base64');
    await harness.rawDb().execute(sql`TRUNCATE TABLE ai_providers, settings`);
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.SILO_SECRET_KEY;
    else process.env.SILO_SECRET_KEY = savedKey;
  });
  const setAi = async (
    model: { provider: 'anthropic' | 'openai' | 'gateway'; id: string } | null,
    enabled = true,
    featureEnabled = true,
  ) => {
    // Stored legacy selections can precede their first list refresh.
    await harness
      .rawDb()
      .execute(
        sql`INSERT INTO settings (key,value) VALUES ('ai', ${JSON.stringify({ enabled, features: { 'x-post-title': { enabled: featureEnabled, model } } })}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      );
  };
  const loadModels = async () => {
    await harness
      .rawDb()
      .execute(
        sql`UPDATE ai_providers SET models = '[{"id":"gpt-6-luna","label":"Luna","structuredOutput":"unknown","reasoning":{"type":"openai","effort":"none"}},{"id":"gpt-6-astra","label":"Astra","structuredOutput":"unknown","reasoning":{"type":"openai","effort":"low"}}]'::jsonb, models_fetched_at = NOW() WHERE kind = 'openai'`,
      );
  };
  const feature = async () => (await harness.mod().status.aiStatus()).features['x-post-title'];

  it('requires master consent, feature consent, secret key and an explicit model', async () => {
    const { status } = harness.mod();
    expect(await feature()).toMatchObject({ ready: false, reason: 'disabled' });
    await setAi(null);
    expect(await feature()).toMatchObject({
      ready: false,
      reason: 'no_model',
      provider: null,
      model: null,
    });
    expect(await status.resolveAiFeatureCredential('x-post-title')).toBeUndefined();
    await setAi(null, true, false);
    expect(await feature()).toMatchObject({ reason: 'feature_disabled' });
    delete process.env.SILO_SECRET_KEY;
    expect(await feature()).toMatchObject({ reason: 'no_secret_key' });
    expect((await status.aiStatus()).secretKey).toBe('missing');
    process.env.SILO_SECRET_KEY = 'bad';
    expect((await status.aiStatus()).secretKey).toBe('invalid');
  });

  it('requires a readable key and returns only the selected model', async () => {
    const { status, providers } = harness.mod();
    await setAi({ provider: 'openai', id: 'gpt-6-astra' });
    expect(await feature()).toMatchObject({ reason: 'no_key' });
    await providers.saveAiProviderKey('openai', FAKE_KEY);
    expect(await feature()).toMatchObject({ reason: 'list_not_loaded', model: null });
    expect(
      (await harness.mod().settings.getSetting('ai')).features['x-post-title'].model,
    ).toBeNull();
    await loadModels();
    expect(await feature()).toEqual({
      ready: true,
      reason: null,
      provider: 'openai',
      model: 'gpt-6-astra',
    });
    expect(await status.isAiFeatureOn('x-post-title')).toBe(true);
    expect(await status.resolveAiFeatureCredential('x-post-title')).toMatchObject({
      kind: 'openai',
      apiKey: FAKE_KEY,
      model: { id: 'gpt-6-astra' },
    });
    const serialized = JSON.stringify(await status.aiStatus());
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain('v1.');
    process.env.SILO_SECRET_KEY = randomBytes(32).toString('base64');
    expect(await feature()).toMatchObject({ reason: 'key_unreadable' });
    expect(await status.resolveAiFeatureCredential('x-post-title')).toBeUndefined();
  });

  it('never defaults a retired stored selection on a feature run', async () => {
    const { status, providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    await harness
      .rawDb()
      .execute(
        sql`UPDATE ai_providers SET models = '[{"id":"claude-haiku-5-5","label":"Haiku","structuredOutput":"native","reasoning":{"type":"anthropic"}}]'::jsonb WHERE kind = 'anthropic'`,
      );
    await harness
      .rawDb()
      .execute(
        sql`INSERT INTO settings (key, value) VALUES ('ai', ${JSON.stringify({ enabled: true, provider: 'anthropic', model: 'retired-model', features: { 'x-post-title': true } })}::jsonb)`,
      );
    expect(await feature()).toMatchObject({ ready: false, reason: 'no_model', model: null });
    expect(await status.resolveAiFeatureCredential('x-post-title')).toBeUndefined();
  });

  it('connection tests use a provider default while AI is off; explicit bad models fail closed', async () => {
    const { status, providers } = harness.mod();
    expect(await status.resolveAiCredential('openai')).toBeUndefined();
    await providers.saveAiProviderKey('openai', FAKE_KEY);
    await loadModels();
    expect(await status.resolveAiCredential('openai')).toMatchObject({
      kind: 'openai',
      model: { id: 'gpt-6-luna' },
    });
    expect(await status.resolveAiCredential('openai', 'gpt-6-astra')).toMatchObject({
      model: { id: 'gpt-6-astra' },
    });
    expect(await status.resolveAiCredential('openai', 'claude-haiku-5-5')).toBeUndefined();
    expect(await status.resolveAiFeatureCredential('x-post-title')).toBeUndefined();
  });
  it('distinguishes a successfully loaded empty list from a list not fetched yet', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('openai', FAKE_KEY);
    await setAi({ provider: 'openai', id: 'gpt-6-luna' });
    expect(await feature()).toMatchObject({ reason: 'list_not_loaded', model: null });
    await harness
      .rawDb()
      .execute(
        sql`UPDATE ai_providers SET models = '[]'::jsonb, models_fetched_at = NOW() WHERE kind = 'openai'`,
      );
    expect(await feature()).toMatchObject({ reason: 'no_model', model: null });
  });
  it('nulls an unlisted model in status even when master consent is off', async () => {
    await setAi({ provider: 'openai', id: 'removed' }, false);
    expect(await feature()).toMatchObject({ reason: 'disabled', model: null });
  });
});
