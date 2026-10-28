import { randomBytes } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as Providers from './providers.js';
import type * as Tester from './tester.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const FAKE_KEY = 'sk-test-0000000000000000';

type Mods = { providers: typeof Providers; tester: typeof Tester };

describeIfPg('testAiProvider (integration)', () => {
  const harness = setupPgHarness(
    'silo_core_ai_tester_test',
    async (): Promise<Mods> => ({
      providers: await import('./providers.js'),
      tester: await import('./tester.js'),
    }),
  );
  let savedKey: string | undefined;

  beforeEach(async () => {
    savedKey = process.env.SILO_SECRET_KEY;
    process.env.SILO_SECRET_KEY = randomBytes(32).toString('base64');
    await harness.rawDb().execute(sql`TRUNCATE TABLE ai_providers, settings`);
    harness.mod().tester.setAiConnectionTester(undefined);
  });

  afterEach(() => {
    harness.mod().tester.setAiConnectionTester(undefined);
    if (savedKey === undefined) delete process.env.SILO_SECRET_KEY;
    else process.env.SILO_SECRET_KEY = savedKey;
  });

  const lastTest = async () =>
    (await harness.mod().providers.listAiProviders()).find((p) => p.kind === 'anthropic')?.lastTest;

  it('returns unavailable with no tester registered, and records nothing', async () => {
    const { tester, providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    expect(await tester.testAiProvider('anthropic')).toEqual({ ok: false, code: 'unavailable' });
    expect(await lastTest()).toBeNull();
  });

  it('returns unavailable when the provider has no key', async () => {
    const { tester } = harness.mod();
    let called = false;
    tester.setAiConnectionTester(async () => {
      called = true;
      return { ok: true, latencyMs: 1 };
    });
    expect(await tester.testAiProvider('openai')).toEqual({ ok: false, code: 'unavailable' });
    expect(called).toBe(false);
  });

  it('runs the tester with the credential and records ok and failure results', async () => {
    const { tester, providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    let seenKey: string | undefined;
    tester.setAiConnectionTester(async (credential) => {
      seenKey = credential.apiKey;
      return { ok: true, latencyMs: 12 };
    });
    expect(await tester.testAiProvider('anthropic')).toEqual({ ok: true, latencyMs: 12 });
    expect(seenKey).toBe(FAKE_KEY);
    expect(await lastTest()).toMatchObject({ ok: true });

    tester.setAiConnectionTester(async () => ({ ok: false, code: 'rate_limited', latencyMs: 5 }));
    expect(await tester.testAiProvider('anthropic')).toEqual({
      ok: false,
      code: 'rate_limited',
      latencyMs: 5,
    });
    expect(await lastTest()).toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('does not hand the ciphertext to the tester', async () => {
    const { tester, providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    let seen = '';
    tester.setAiConnectionTester(async (credential) => {
      seen = Object.keys(credential).sort().join(',');
      return { ok: true, latencyMs: 1 };
    });
    await tester.testAiProvider('anthropic');
    expect(seen).toBe('apiKey,kind,model');
  });

  it('a throwing tester becomes provider_error and is recorded', async () => {
    const { tester, providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    tester.setAiConnectionTester(async () => {
      throw new Error(`boom ${FAKE_KEY}`);
    });
    const result = await tester.testAiProvider('anthropic');
    expect(result).toMatchObject({ ok: false, code: 'provider_error' });
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    expect(await lastTest()).toMatchObject({ ok: false, code: 'provider_error' });
  });

  it('keeps only known fields and maps an unknown code to provider_error', async () => {
    const { tester, providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    tester.setAiConnectionTester(
      async () =>
        ({
          ok: false,
          code: 'weird',
          latencyMs: 3,
          detail: FAKE_KEY,
        }) as unknown as Tester.AiConnectionResult,
    );
    expect(await tester.testAiProvider('anthropic')).toEqual({
      ok: false,
      code: 'provider_error',
      latencyMs: 3,
    });
    tester.setAiConnectionTester(
      async () =>
        ({ ok: true, latencyMs: 4, extra: FAKE_KEY }) as unknown as Tester.AiConnectionResult,
    );
    expect(await tester.testAiProvider('anthropic')).toEqual({ ok: true, latencyMs: 4 });
  });

  it('drops the result when the key was replaced while the test ran', async () => {
    const { tester, providers } = harness.mod();
    await providers.saveAiProviderKey('anthropic', FAKE_KEY);
    tester.setAiConnectionTester(async () => {
      await providers.saveAiProviderKey('anthropic', 'sk-test-1111111111111111');
      return { ok: false, code: 'invalid_key', latencyMs: 2 };
    });
    await tester.testAiProvider('anthropic');
    expect(await lastTest()).toBeNull();
  });
});
