import { randomBytes } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as Providers from './providers.js';
import type * as SecretBox from './secret-box.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const newKey = () => randomBytes(32).toString('base64');
const FAKE_KEY = 'sk-test-0000000000000000';

type Mods = {
  providers: typeof Providers;
  box: typeof SecretBox;
  settings: typeof import('../settings/settings.js');
};

describeIfPg('ai provider storage (integration)', () => {
  const harness = setupPgHarness(
    'silo_core_ai_providers_test',
    async (): Promise<Mods> => ({
      providers: await import('./providers.js'),
      box: await import('./secret-box.js'),
      settings: await import('../settings/settings.js'),
    }),
  );
  let saved: { key?: string; previous?: string };

  beforeEach(async () => {
    saved = {
      ...(process.env.SILO_SECRET_KEY ? { key: process.env.SILO_SECRET_KEY } : {}),
      ...(process.env.SILO_SECRET_KEY_PREVIOUS
        ? { previous: process.env.SILO_SECRET_KEY_PREVIOUS }
        : {}),
    };
    process.env.SILO_SECRET_KEY = newKey();
    delete process.env.SILO_SECRET_KEY_PREVIOUS;
    await harness.rawDb().execute(sql`TRUNCATE TABLE ai_providers, settings`);
  });

  afterEach(() => {
    for (const [name, value] of [
      ['SILO_SECRET_KEY', saved.key],
      ['SILO_SECRET_KEY_PREVIOUS', saved.previous],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const storedBlob = async (kind: string): Promise<string> => {
    const result = await harness
      .rawDb()
      .execute(sql`SELECT encrypted_key FROM ai_providers WHERE kind = ${kind}`);
    return (result.rows[0] as { encrypted_key: string }).encrypted_key;
  };

  it('lists all three kinds as not configured on a fresh database', async () => {
    const list = await harness.mod().providers.listAiProviders();
    expect(list.map((p) => p.kind)).toEqual(['anthropic', 'openai', 'gateway', 'fireworks']);
    expect(list.every((p) => !p.configured && p.keyLast4 === null && p.lastTest === null)).toBe(
      true,
    );
  });

  it('saves a trimmed key encrypted, and the list never exposes key or ciphertext', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', `  ${FAKE_KEY}  `);

    const blob = await storedBlob('anthropic');
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain(FAKE_KEY);

    const list = await providers.listAiProviders();
    const row = list.find((p) => p.kind === 'anthropic');
    expect(row).toMatchObject({ configured: true, keyLast4: '0000', lastTest: null });
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(FAKE_KEY);
    expect(serialized).not.toContain(blob);
    expect(serialized).not.toContain('encrypted');
  });

  it('rejects keys outside 8-300 printable ASCII without echoing them', async () => {
    const { providers } = harness.mod();
    for (const bad of [
      'short',
      'has space inside-0000',
      `${'a'.repeat(301)}`,
      'café-key-0000',
      '',
    ]) {
      const error = await providers.saveAiProviderKey('openai', bad).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(providers.InvalidAiApiKeyError);
      expect(String(error)).not.toContain(bad || 'never-empty-match');
    }
    expect((await providers.listAiProviders()).every((p) => !p.configured)).toBe(true);
  });

  it('save throws SecretKeyMissingError with no secret key and stores nothing', async () => {
    const { providers, box } = harness.mod();
    delete process.env.SILO_SECRET_KEY;
    await expect(providers.saveAiProviderKey('gateway', FAKE_KEY)).rejects.toBeInstanceOf(
      box.SecretKeyMissingError,
    );
    expect((await providers.listAiProviders()).every((p) => !p.configured)).toBe(true);
  });

  it('replacing a key clears the previous test result', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('openai', FAKE_KEY);
    await providers.recordAiTest('openai', { ok: false, code: 'invalid_key' });
    const tested = (await providers.listAiProviders()).find((p) => p.kind === 'openai');
    expect(tested?.lastTest).toMatchObject({ ok: false, code: 'invalid_key' });

    await providers.saveAiProviderKey('openai', 'sk-test-1111111111111111');
    const replaced = (await providers.listAiProviders()).find((p) => p.kind === 'openai');
    expect(replaced).toMatchObject({ keyLast4: '1111', lastTest: null });
  });

  it('recordAiTest stores ok results and ignores a kind with no row', async () => {
    const { providers } = harness.mod();
    await providers.recordAiTest('gateway', { ok: true });
    await providers.saveAiProviderKey('gateway', FAKE_KEY);
    await providers.recordAiTest('gateway', { ok: true });
    const row = (await providers.listAiProviders()).find((p) => p.kind === 'gateway');
    expect(row?.lastTest).toMatchObject({ ok: true, code: null });
  });

  it('removeAiProvider deletes the row and clears ai.provider and ai.model for that kind', async () => {
    const { providers, settings } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    await settings.setSetting('ai', {
      enabled: true,
      features: {
        'x-post-title': {
          enabled: false,
          model: { provider: 'anthropic', id: 'claude-sonnet-5-5' },
        },
      },
    });

    await providers.removeAiProvider('anthropic');

    expect(
      (await providers.listAiProviders()).find((p) => p.kind === 'anthropic')?.configured,
    ).toBe(false);
    expect(await settings.getSetting('ai')).toEqual({
      enabled: true,
      features: { 'x-post-title': { enabled: false, model: null } },
    });
  });

  it('removeAiProvider leaves ai.provider alone when another kind is selected', async () => {
    const { providers, settings } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    await providers.saveAiProviderKey('openai', FAKE_KEY);
    const selected = {
      enabled: true,
      features: {
        'x-post-title': {
          enabled: false,
          model: { provider: 'openai' as const, id: 'gpt-6-astra' },
        },
      },
    };
    await settings.setSetting('ai', selected);

    await providers.removeAiProvider('anthropic');
    expect(await settings.getSetting('ai')).toEqual(selected);
  });

  it('readAiProviderKey reports no_key and key_unreadable states', async () => {
    const { providers } = harness.mod();
    expect(await providers.readAiProviderKey('openai')).toEqual({ state: 'no_key' });
    await providers.saveAiProviderKey('openai', FAKE_KEY);
    expect(await providers.readAiProviderKey('openai')).toMatchObject({
      state: 'ok',
      apiKey: FAKE_KEY,
    });
    process.env.SILO_SECRET_KEY = newKey();
    expect(await providers.readAiProviderKey('openai')).toEqual({ state: 'key_unreadable' });
  });

  it('a ciphertext copied to another row fails to decrypt (AAD binding)', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    const blob = await storedBlob('anthropic');
    await harness
      .rawDb()
      .execute(
        sql`INSERT INTO ai_providers (kind, encrypted_key, key_last4) VALUES ('openai', ${blob}, '0000')`,
      );
    expect(await providers.readAiProviderKey('openai')).toEqual({ state: 'key_unreadable' });
  });

  it('rotation: reencryptAiProviders moves previous-key rows to the current kid', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    await providers.saveAiProviderKey('openai', 'sk-test-2222222222222222');
    const before = await storedBlob('anthropic');

    process.env.SILO_SECRET_KEY_PREVIOUS = process.env.SILO_SECRET_KEY as string;
    process.env.SILO_SECRET_KEY = newKey();
    expect(await providers.reencryptAiProviders()).toEqual({ reencrypted: 2, unreadable: 0 });

    const after = await storedBlob('anthropic');
    expect(after.split('.')[1]).not.toBe(before.split('.')[1]);
    delete process.env.SILO_SECRET_KEY_PREVIOUS;
    expect(await providers.readAiProviderKey('anthropic')).toMatchObject({
      state: 'ok',
      apiKey: FAKE_KEY,
    });
    expect(await providers.readAiProviderKey('openai')).toMatchObject({
      state: 'ok',
      apiKey: 'sk-test-2222222222222222',
    });
    expect(await providers.reencryptAiProviders()).toEqual({ reencrypted: 0, unreadable: 0 });
  });

  it('reencryptAiProviders does not overwrite a key saved after it read the rows (CAS)', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    process.env.SILO_SECRET_KEY_PREVIOUS = process.env.SILO_SECRET_KEY as string;
    process.env.SILO_SECRET_KEY = newKey();

    const result = await providers.reencryptAiProviders({
      afterRead: () => providers.saveAiProviderKey('anthropic', 'sk-test-3333333333333333'),
    });

    expect(result).toEqual({ reencrypted: 0, unreadable: 0 });
    expect(await providers.readAiProviderKey('anthropic')).toMatchObject({
      state: 'ok',
      apiKey: 'sk-test-3333333333333333',
    });
  });

  it('reencryptAiProviders leaves unreadable rows untouched and counts them', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    const before = await storedBlob('anthropic');
    process.env.SILO_SECRET_KEY = newKey();
    expect(await providers.reencryptAiProviders()).toEqual({ reencrypted: 0, unreadable: 1 });
    expect(await storedBlob('anthropic')).toBe(before);
  });

  it('reencryptAiProviders does nothing without a valid current key', async () => {
    const { providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    delete process.env.SILO_SECRET_KEY;
    expect(await providers.reencryptAiProviders()).toEqual({ reencrypted: 0, unreadable: 0 });
  });
});
