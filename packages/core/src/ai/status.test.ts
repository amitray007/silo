import { randomBytes } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as Providers from './providers.js';
import type * as Status from './status.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const newKey = () => randomBytes(32).toString('base64');
const FAKE_KEY = 'sk-test-0000000000000000';

type Mods = {
  status: typeof Status;
  providers: typeof Providers;
  settings: typeof import('../settings/settings.js');
};

describeIfPg('ai status, credential and tester (integration)', () => {
  const harness = setupPgHarness(
    'silo_core_ai_status_test',
    async (): Promise<Mods> => ({
      status: await import('./status.js'),
      providers: await import('./providers.js'),
      settings: await import('../settings/settings.js'),
    }),
  );
  let savedKey: string | undefined;

  beforeEach(async () => {
    savedKey = process.env.SILO_SECRET_KEY;
    process.env.SILO_SECRET_KEY = newKey();
    await harness.rawDb().execute(sql`TRUNCATE TABLE ai_providers, settings`);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.SILO_SECRET_KEY;
    else process.env.SILO_SECRET_KEY = savedKey;
  });

  const setAi = (over: Record<string, unknown>) =>
    harness.mod().settings.setSetting('ai', {
      enabled: true,
      provider: null,
      model: null,
      features: {},
      ...over,
    });

  describe('aiStatus', () => {
    it('reports disabled by default', async () => {
      expect(await harness.mod().status.aiStatus()).toMatchObject({
        enabled: false,
        ready: false,
        reason: 'disabled',
        provider: null,
        model: null,
      });
    });

    it('reports no_secret_key for a missing or invalid key', async () => {
      const { status } = harness.mod();
      await setAi({});
      delete process.env.SILO_SECRET_KEY;
      expect(await status.aiStatus()).toMatchObject({
        secretKey: 'missing',
        reason: 'no_secret_key',
      });
      process.env.SILO_SECRET_KEY = 'bad';
      expect(await status.aiStatus()).toMatchObject({
        secretKey: 'invalid',
        reason: 'no_secret_key',
      });
    });

    it('reports no_provider, then no_key, then key_unreadable, then ready', async () => {
      const { status, providers } = harness.mod();
      await setAi({});
      expect(await status.aiStatus()).toMatchObject({ ready: false, reason: 'no_provider' });

      await setAi({ provider: 'anthropic' });
      expect(await status.aiStatus()).toMatchObject({ ready: false, reason: 'no_key' });

      await providers.saveAiProviderKey('anthropic', FAKE_KEY);
      const ready = await status.aiStatus();
      expect(ready).toMatchObject({
        ready: true,
        provider: 'anthropic',
        model: { id: 'claude-haiku-5-5', fellBack: false },
      });
      expect(ready.reason).toBeUndefined();

      const original = process.env.SILO_SECRET_KEY as string;
      process.env.SILO_SECRET_KEY = newKey();
      expect(await status.aiStatus()).toMatchObject({ ready: false, reason: 'key_unreadable' });
      process.env.SILO_SECRET_KEY = original;
    });

    it('never contains the key or ciphertext', async () => {
      const { status, providers } = harness.mod();
      await providers.saveAiProviderKey('openai', FAKE_KEY);
      await setAi({ provider: 'openai', model: 'gpt-6-astra' });
      const serialized = JSON.stringify(await status.aiStatus());
      expect(serialized).not.toContain(FAKE_KEY);
      expect(serialized).not.toContain('v1.');
    });

    it('keeps enabled and provider and reports the default model when the stored model left the catalog', async () => {
      const { status } = harness.mod();
      await harness.rawDb().execute(
        sql`INSERT INTO settings (key, value) VALUES ('ai', ${JSON.stringify({
          enabled: true,
          provider: 'anthropic',
          model: 'retired-model',
          features: {},
        })}::jsonb)`,
      );
      expect(await status.aiStatus()).toMatchObject({
        enabled: true,
        provider: 'anthropic',
        model: { id: 'claude-haiku-5-5', fellBack: false },
        reason: 'no_key',
      });
    });
  });

  describe('resolveAiCredential', () => {
    it('returns undefined until AI is ready', async () => {
      const { status, providers } = harness.mod();
      await providers.saveAiProviderKey('anthropic', FAKE_KEY);
      expect(await status.resolveAiCredential()).toBeUndefined();
      await setAi({ enabled: false, provider: 'anthropic' });
      expect(await status.resolveAiCredential()).toBeUndefined();
    });

    it('returns the key and the chosen model when ready', async () => {
      const { status, providers } = harness.mod();
      await providers.saveAiProviderKey('gateway', FAKE_KEY);
      await setAi({ provider: 'gateway', model: 'gpt-6-astra' });
      const credential = await status.resolveAiCredential();
      expect(credential).toMatchObject({ kind: 'gateway', apiKey: FAKE_KEY });
      expect(credential?.model.id).toBe('gpt-6-astra');
    });

    it('with an override kind ignores ai.enabled and uses that kind default model', async () => {
      const { status, providers } = harness.mod();
      await providers.saveAiProviderKey('openai', FAKE_KEY);
      await setAi({ enabled: false, provider: 'anthropic' });
      const credential = await status.resolveAiCredential('openai');
      expect(credential).toMatchObject({ kind: 'openai', apiKey: FAKE_KEY });
      expect(credential?.model.id).toBe('gpt-6-luna');
    });

    it('with an override that matches ai.provider uses ai.model', async () => {
      const { status, providers } = harness.mod();
      await providers.saveAiProviderKey('openai', FAKE_KEY);
      await setAi({ enabled: false, provider: 'openai', model: 'gpt-6-astra' });
      expect((await status.resolveAiCredential('openai'))?.model.id).toBe('gpt-6-astra');
    });

    it('is undefined for an override with no key or no secret key', async () => {
      const { status, providers } = harness.mod();
      expect(await status.resolveAiCredential('anthropic')).toBeUndefined();
      await providers.saveAiProviderKey('anthropic', FAKE_KEY);
      delete process.env.SILO_SECRET_KEY;
      expect(await status.resolveAiCredential('anthropic')).toBeUndefined();
    });
  });
});
