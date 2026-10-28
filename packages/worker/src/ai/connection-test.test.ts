import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiConnectionTester } from './connection-test.js';
import { apiError, credential, LEAK_KEY, okResult } from './test-helpers.js';

vi.mock('./model.js', () => ({ languageModelFor: vi.fn() }));
const { languageModelFor } = await import('./model.js');

afterEach(() => vi.clearAllMocks());

describe('aiConnectionTester', () => {
  it('returns ok with a latency', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => okResult('ok') });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const result = await aiConnectionTester(credential);
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(256);
  });

  it.each([
    [401, 'invalid_key'],
    [402, 'quota'],
    [404, 'model_not_found'],
    [412, 'no_access'],
  ] as const)('maps %s to %s, with no retry and no key in the result', async (status, code) => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw apiError(status);
      },
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const result = await aiConnectionTester(credential);
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(LEAK_KEY);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('does not throw when the model cannot be built', async () => {
    vi.mocked(languageModelFor).mockImplementation(() => {
      throw new Error('empty key');
    });
    expect(await aiConnectionTester(credential)).toMatchObject({ ok: false });
  });

  it('counts a completed call with no text as ok, with room for reasoning models', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({ ...okResult(''), content: [] }),
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    expect(await aiConnectionTester(credential)).toMatchObject({ ok: true });
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(256);
  });
  it('sends no reasoning setting for a Fireworks key test', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => okResult('ok') });
    vi.mocked(languageModelFor).mockReturnValue(model);
    expect(await aiConnectionTester({ ...credential, kind: 'fireworks' })).toMatchObject({
      ok: true,
    });
    expect(model.doGenerateCalls[0]?.reasoning).toBeUndefined();
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(256);
  });
});
