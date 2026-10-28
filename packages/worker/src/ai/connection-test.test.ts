import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiConnectionTester } from './connection-test.js';
import { apiError, credential, fakeAbortTimeout, LEAK_KEY, okResult } from './test-helpers.js';

vi.mock('./model.js', () => ({ languageModelFor: vi.fn() }));
const { languageModelFor } = await import('./model.js');

let testId = 0;
beforeEach(() => {
  credential.model.id = `test-haiku-${++testId}`;
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('aiConnectionTester', () => {
  it('returns ok with a latency', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => okResult('ok') });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const result = await aiConnectionTester(credential);
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(1024);
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
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(1024);
  });
  it('sends low reasoning and 1024 output tokens for a Fireworks key test', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => okResult('ok') });
    vi.mocked(languageModelFor).mockReturnValue(model);
    expect(await aiConnectionTester({ ...credential, kind: 'fireworks' })).toMatchObject({
      ok: true,
    });
    expect(model.doGenerateCalls[0]?.reasoning).toBeUndefined();
    expect(model.doGenerateCalls[0]?.providerOptions).toEqual({
      fireworks: { reasoningEffort: 'low' },
    });
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(1024);
  });

  it('allows a healthy Fireworks generation longer than 15 seconds', async () => {
    vi.useFakeTimers();
    fakeAbortTimeout();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        return okResult('ok');
      },
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const result = aiConnectionTester({ ...credential, kind: 'fireworks' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ ok: true, latencyMs: 20_000 });
  });

  it('retries a reasoning 400 once without the option inside the 30 second deadline', async () => {
    vi.useFakeTimers();
    fakeAbortTimeout();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          throw apiError(400, `Unsupported reasoning_effort ${LEAK_KEY}`);
        }
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
        });
      },
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const result = aiConnectionTester({ ...credential, kind: 'fireworks' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ ok: false, code: 'timeout', latencyMs: 30_000 });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1]?.providerOptions?.fireworks).toBeUndefined();
    expect(model.doGenerateCalls[1]?.maxOutputTokens).toBe(1024);
  });
});
