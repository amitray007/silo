import { randomBytes } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type { AiFeatureId } from './features.js';

// Register a second fixture feature without shipping one or changing worker parity.
vi.mock('./features.js', async (original) => {
  const actual = await original<typeof import('./features.js')>();
  return {
    ...actual,
    AI_FEATURES: [
      ...actual.AI_FEATURES,
      { id: 'fixture-chat', label: 'Fixture chat', description: 'Test only' },
    ],
  };
});
const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('independent feature selections', () => {
  const harness = setupPgHarness('silo_ai_multi_feature', async () => ({
    status: await import('./status.js'),
    providers: await import('./providers.js'),
    settings: await import('../settings/settings.js'),
  }));
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SILO_SECRET_KEY;
    process.env.SILO_SECRET_KEY = randomBytes(32).toString('base64');
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SILO_SECRET_KEY;
    else process.env.SILO_SECRET_KEY = saved;
  });
  it('resolves two features to their own providers and removal affects only that provider', async () => {
    const { status, providers, settings } = harness.mod();
    await providers.saveAiProviderKey('anthropic', 'fake-anthropic-1234');
    await providers.saveAiProviderKey('openai', 'fake-openai-5678');
    await harness
      .rawDb()
      .execute(
        sql`UPDATE ai_providers SET models = CASE kind WHEN 'anthropic' THEN '[{"id":"claude-haiku-5-5","label":"Haiku","structuredOutput":"native","reasoning":{"type":"anthropic"}}]'::jsonb ELSE '[{"id":"gpt-6-astra","label":"Astra","structuredOutput":"unknown","reasoning":{"type":"openai"}}]'::jsonb END`,
      );
    await settings.setSetting('ai', {
      enabled: true,
      features: {
        'x-post-title': { enabled: true, model: { provider: 'anthropic', id: 'claude-haiku-5-5' } },
        'fixture-chat': { enabled: true, model: { provider: 'openai', id: 'gpt-6-astra' } },
      },
    });
    expect(await status.resolveAiFeatureCredential('x-post-title')).toMatchObject({
      kind: 'anthropic',
      apiKey: 'fake-anthropic-1234',
      model: { id: 'claude-haiku-5-5' },
    });
    const fixtureId = 'fixture-chat' as AiFeatureId;
    expect(await status.resolveAiFeatureCredential(fixtureId)).toMatchObject({
      kind: 'openai',
      apiKey: 'fake-openai-5678',
      model: { id: 'gpt-6-astra' },
    });
    await providers.removeAiProvider('anthropic');
    expect(await status.resolveAiFeatureCredential('x-post-title')).toBeUndefined();
    expect(await status.resolveAiFeatureCredential(fixtureId)).toMatchObject({ kind: 'openai' });
  });
});
