import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiFeatureDefinition } from './define.js';
import { runAiFeature } from './run.js';
import {
  apiError,
  credential,
  deferred,
  failingModel,
  LEAK_KEY,
  okResult,
} from './test-helpers.js';

const PROMPT_TEXT = 'SECRET PROMPT TEXT about a tweet';

const definition = {
  id: 'test_feature' as never,
  promptVersion: 2,
  instructions: 'Write a title.',
  buildPrompt: (input: { text: string }) => `${PROMPT_TEXT} ${input.text}`,
  schema: z.object({ title: z.string() }),
  postProcess: (output: { title: string }) => output.title.trim() || undefined,
  timeoutMs: 5000,
} satisfies AiFeatureDefinition<{ text: string }, string, { title: string }>;

const okModel = () =>
  new MockLanguageModelV4({ doGenerate: async () => okResult('{"title":" Hello "}') });

function deps(model: MockLanguageModelV4, overrides = {}) {
  return {
    isFeatureOn: async () => true,
    credential: async () => credential,
    model: () => model,
    ...overrides,
  };
}

/** Runs the pending retry back-off timers so tests do not wait for real delays. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  while (!done) {
    await vi.advanceTimersByTimeAsync(5000);
  }
  return tracked;
}

let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  logs = [
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  ];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const logged = () => JSON.stringify(logs.flatMap((spy) => spy.mock.calls));

describe('runAiFeature', () => {
  it('returns the post-processed value', async () => {
    const model = okModel();
    const result = await runAiFeature(definition, { text: 'hi' }, deps(model));
    expect(result).toEqual({ ok: true, value: 'Hello' });
    const call = model.doGenerateCalls[0];
    expect(call?.maxOutputTokens).toBe(200);
    expect(call?.reasoning).toBe('none');
  });

  it('returns off without calling the model when the gate is off', async () => {
    const model = okModel();
    const result = await runAiFeature(
      definition,
      { text: 'hi' },
      deps(model, { isFeatureOn: async () => false }),
    );
    expect(result).toEqual({ ok: false, code: 'off' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('returns off when there is no credential', async () => {
    const model = okModel();
    const result = await runAiFeature(
      definition,
      { text: 'hi' },
      deps(model, { credential: async () => undefined }),
    );
    expect(result).toEqual({ ok: false, code: 'off' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('returns timeout without reading settings or calling the model when already aborted', async () => {
    const model = okModel();
    const isFeatureOn = vi.fn(async () => true);
    const result = await runAiFeature(
      definition,
      { text: 'hi' },
      deps(model, { isFeatureOn, abortSignal: AbortSignal.abort('private abort reason') }),
    );
    expect(result).toEqual({ ok: false, code: 'timeout' });
    expect(isFeatureOn).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(logs[0]?.mock.calls).toEqual([['silo ai: test_feature@v2 failed (timeout)']]);
    expect(logged()).not.toContain('private abort reason');
  });

  it.each(['readiness', 'credential'] as const)(
    'does not start a provider call after aborting a slow %s read',
    async (stage) => {
      const controller = new AbortController();
      const pending = deferred<void>();
      const started = deferred<void>();
      const model = okModel();
      const slowRead = async () => {
        started.resolve();
        await pending.promise;
      };
      const run = runAiFeature(
        definition,
        { text: 'hi' },
        deps(model, {
          abortSignal: controller.signal,
          isFeatureOn: async () => {
            if (stage === 'readiness') await slowRead();
            return true;
          },
          credential: async () => {
            if (stage === 'credential') await slowRead();
            return credential;
          },
        }),
      );
      await started.promise;
      controller.abort();
      pending.resolve();
      expect(await run).toEqual({ ok: false, code: 'timeout' });
      expect(model.doGenerateCalls).toHaveLength(0);
      expect(logs[0]?.mock.calls).toEqual([['silo ai: test_feature@v2 failed (timeout)']]);
    },
  );

  it('passes caller cancellation to an in-flight provider request', async () => {
    const controller = new AbortController();
    const started = deferred<AbortSignal | undefined>();
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          started.resolve(abortSignal);
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
        }),
    });
    const run = runAiFeature(
      definition,
      { text: 'hi' },
      deps(model, {
        abortSignal: controller.signal,
      }),
    );
    const providerSignal = await started.promise;
    controller.abort();
    expect(await run).toEqual({ ok: false, code: 'timeout' });
    expect(providerSignal?.aborted).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(logs[0]?.mock.calls).toEqual([['silo ai: test_feature@v2 failed (timeout)']]);
  });

  it.each([
    [401, 'invalid_key'],
    [402, 'quota'],
    [404, 'model_not_found'],
  ] as const)('maps %s to %s without retrying', async (status, code) => {
    const model = failingModel(apiError(status));
    const result = await runAiFeature(definition, { text: 'hi' }, deps(model));
    expect(result).toEqual({ ok: false, code });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('retries a 429 and then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) throw apiError(429);
        return okResult('{"title":"Fine"}');
      },
    });
    const result = await settle(runAiFeature(definition, { text: 'hi' }, deps(model)));
    expect(result).toEqual({ ok: true, value: 'Fine' });
    expect(calls).toBe(2);
  });

  it('returns rate_limited after three 429s', async () => {
    vi.useFakeTimers();
    const model = failingModel(apiError(429));
    const result = await settle(runAiFeature(definition, { text: 'hi' }, deps(model)));
    expect(result).toEqual({ ok: false, code: 'rate_limited' });
    expect(model.doGenerateCalls).toHaveLength(3);
  });

  it('returns timeout when the model outlives timeoutMs', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
        }),
    });
    const result = await runAiFeature(
      { ...definition, timeoutMs: 30 },
      { text: 'hi' },
      deps(model),
    );
    expect(result).toEqual({ ok: false, code: 'timeout' });
  });

  it('returns network for a fetch failure', async () => {
    vi.useFakeTimers();
    const model = failingModel(new TypeError('fetch failed'));
    const result = await settle(runAiFeature(definition, { text: 'hi' }, deps(model)));
    expect(result).toEqual({ ok: false, code: 'network' });
  });

  it('returns invalid_output when the output does not match the schema', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => okResult('{"nope":1}') });
    const result = await runAiFeature(definition, { text: 'hi' }, deps(model));
    expect(result).toEqual({ ok: false, code: 'invalid_output' });
  });

  it('returns invalid_output when postProcess rejects the output', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => okResult('{"title":"  "}') });
    const result = await runAiFeature(definition, { text: 'hi' }, deps(model));
    expect(result).toEqual({ ok: false, code: 'invalid_output' });
    expect(logs[0]?.mock.calls).toEqual([['silo ai: test_feature@v2 failed (invalid_output)']]);
  });

  it('never throws, even when a dependency throws', async () => {
    const result = await runAiFeature(
      definition,
      { text: 'hi' },
      deps(okModel(), {
        credential: async () => {
          throw new Error(`db down ${LEAK_KEY}`);
        },
      }),
    );
    expect(result).toEqual({ ok: false, code: 'provider_error' });
    expect(logged()).not.toContain(LEAK_KEY);
  });

  it('leaks neither the key nor the prompt into logs or the result', async () => {
    vi.useFakeTimers();
    for (const status of [401, 403, 429, 500, undefined]) {
      const model = failingModel(apiError(status));
      const result = await settle(runAiFeature(definition, { text: 'hi' }, deps(model)));
      expect(JSON.stringify(result)).not.toContain(LEAK_KEY);
    }
    const text = logged();
    expect(text).not.toContain(LEAK_KEY);
    expect(text).not.toContain('SECRET PROMPT');
    expect(text).toContain('silo ai: test_feature@v2 failed (');
  });

  it('returns invalid_output when the model produces no output', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        ...okResult(''),
        content: [],
        finishReason: { unified: 'length', raw: 'length' },
      }),
    });
    const result = await runAiFeature(definition, { text: 'hi' }, deps(model));
    expect(result).toEqual({ ok: false, code: 'invalid_output' });
  });

  it('sends instructions, prompt, the maxOutputTokens override and the reasoning setting', async () => {
    const model = okModel();
    await runAiFeature(
      { ...definition, maxOutputTokens: 77 },
      { text: 'hi' },
      deps(model, {
        credential: async () => ({
          ...credential,
          model: { ...credential.model, reasoning: 'low' },
        }),
      }),
    );
    const call = model.doGenerateCalls[0];
    expect(call?.maxOutputTokens).toBe(77);
    expect(call?.reasoning).toBe('low');
    const sent = JSON.stringify(call?.prompt);
    expect(sent).toContain('Write a title.');
    expect(sent).toContain(`${PROMPT_TEXT} hi`);
  });
  it('resolves the requested feature and omits reasoning for Fireworks even with a curated credential', async () => {
    const model = okModel();
    const load = vi.fn(async () => ({ ...credential, kind: 'fireworks' as const }));
    expect(
      await runAiFeature(definition, { text: 'hi' }, deps(model, { credential: load })),
    ).toEqual({ ok: true, value: 'Hello' });
    expect(load).toHaveBeenCalledWith(definition.id);
    expect(model.doGenerateCalls[0]?.reasoning).toBeUndefined();
  });
});
