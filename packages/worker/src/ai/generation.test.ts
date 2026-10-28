import type { AiLiveModel, AiProviderKind } from '@silo/core';
import { generateText, NoOutputGeneratedError, Output } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withModelSettings } from './generation.js';
import { languageModelFor } from './model.js';
import { runAiFeature } from './run.js';
import { apiError, credential, okResult } from './test-helpers.js';

const cases: {
  kind: AiProviderKind;
  id: string;
  reasoning: AiLiveModel['reasoning'];
  body: Record<string, unknown>;
}[] = [
  {
    kind: 'anthropic',
    id: 'claude-haiku-5-5',
    reasoning: { type: 'anthropic', thinking: 'disabled', effort: 'low' },
    body: {
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    },
  },
  {
    kind: 'anthropic',
    id: 'claude-sonnet-5-5',
    reasoning: { type: 'anthropic', thinking: 'between_tools', effort: 'low' },
    body: {
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    },
  },
  {
    kind: 'anthropic',
    id: 'claude-opus-5-5',
    reasoning: { type: 'anthropic', thinking: 'adaptive', effort: 'low' },
    body: {
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    },
  },
  {
    kind: 'openai',
    id: 'gpt-6-astra',
    reasoning: { type: 'openai', effort: 'low' },
    body: { reasoning: { effort: 'low' } },
  },
  {
    kind: 'openai',
    id: 'gpt-6-luna',
    reasoning: { type: 'openai', effort: 'none' },
    body: { reasoning: { effort: 'none' } },
  },
  {
    kind: 'openai',
    id: 'gpt-5-mini',
    reasoning: { type: 'openai', effort: 'minimal' },
    body: { reasoning: { effort: 'minimal' } },
  },
  {
    kind: 'gateway',
    id: 'anthropic/claude-opus-5.5',
    reasoning: { type: 'gateway', effort: 'low' },
    body: { reasoning: 'low' },
  },
  {
    kind: 'gateway',
    id: 'alibaba/qwen3-max-thinking',
    reasoning: { type: 'gateway', budgetTokens: 1 },
    body: { reasoning: { max_tokens: 1 } },
  },
];
describe('generation wire settings', () => {
  it.each(cases)(
    '$kind $id sends its minimum settings and 1024 output tokens',
    async ({ kind, id, reasoning, body }) => {
      const sent: Record<string, unknown>[] = [];
      const urls: string[] = [];
      const fetch: typeof globalThis.fetch = async (url, init) => {
        urls.push(String(url));
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ error: { message: 'test failure' } }, { status: 500 });
      };
      const selected = {
        kind,
        apiKey: 'fake-wire-key',
        model: { id, label: id, structuredOutput: 'native' as const, reasoning },
      };
      await withModelSettings(selected, 5000, ({ structuredOutput: _format, ...settings }) =>
        generateText({
          model: languageModelFor(selected, fetch),
          prompt: 'Write a title',
          output: Output.object({ schema: z.object({ title: z.string() }) }),
          maxRetries: 0,
          ...settings,
        }),
      ).catch(() => {});
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject(body);
      if (kind === 'openai') expect(urls[0]).toBe('https://api.openai.com/v1/responses');
      if (
        kind === 'gateway' &&
        reasoning.type === 'gateway' &&
        reasoning.budgetTokens !== undefined
      )
        expect(urls[0]).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
      expect(
        sent[0]?.max_tokens ??
          sent[0]?.max_output_tokens ??
          sent[0]?.maxOutputTokens ??
          sent[0]?.max_completion_tokens,
      ).toBe(1024);
    },
  );
});

const definition = {
  id: 'test_feature' as never,
  promptVersion: 1,
  instructions: 'Write JSON with a title.',
  buildPrompt: () => 'A short post',
  schema: z.object({ title: z.string() }),
  postProcess: (raw: { title: string }) => raw.title,
  timeoutMs: 5000,
};
function run(
  model: MockLanguageModelV4,
  id: string,
  reasoning: AiLiveModel['reasoning'] = { type: 'anthropic', thinking: 'adaptive', effort: 'low' },
) {
  return runAiFeature(definition, undefined, {
    isFeatureOn: async () => true,
    credential: async () => ({ ...credential, model: { ...credential.model, id, reasoning } }),
    model: () => model,
  });
}

describe('bounded fallbacks', () => {
  it.each(['thinking', 'effort', 'reasoning', 'response_format'])(
    'removes only the rejected %s setting and remembers success',
    async (option) => {
      let attempt = 0;
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          if (++attempt === 1) throw apiError(400, `Unsupported ${option}`);
          return okResult('{"title":"Recovered"}');
        },
      });
      expect(await run(model, `remember-${option}`)).toEqual({ ok: true, value: 'Recovered' });
      expect(model.doGenerateCalls).toHaveLength(2);
      const first = model.doGenerateCalls[0];
      const second = model.doGenerateCalls[1];
      expect(first?.providerOptions?.anthropic).toMatchObject({
        thinking: { type: 'adaptive' },
        effort: 'low',
      });
      if (option === 'response_format') {
        expect(first?.responseFormat?.type).toBe('json');
        expect(second?.responseFormat?.type).toBe('text');
      } else if (option === 'reasoning')
        expect(second?.providerOptions?.anthropic).toEqual({
          structuredOutputMode: 'outputFormat',
        });
      else expect(second?.providerOptions?.anthropic).not.toHaveProperty(option);
      expect(await run(model, `remember-${option}`)).toEqual({ ok: true, value: 'Recovered' });
      expect(model.doGenerateCalls[2]?.providerOptions).toEqual(second?.providerOptions);
      expect(model.doGenerateCalls[2]?.responseFormat).toEqual(second?.responseFormat);
    },
  );
  it('keeps separate working settings for each provider/model and never remembers a failed retry', async () => {
    const bad = new MockLanguageModelV4({
      doGenerate: async () => {
        throw apiError(400, 'Unsupported thinking');
      },
    });
    expect((await run(bad, 'failed-settings')).ok).toBe(false);
    expect(bad.doGenerateCalls).toHaveLength(2);
    const good = new MockLanguageModelV4({ doGenerate: async () => okResult('{"title":"Fine"}') });
    await run(good, 'failed-settings');
    await run(good, 'different-model');
    for (const call of good.doGenerateCalls)
      expect(call.providerOptions?.anthropic).toHaveProperty('thinking');
  });
  it.each([401, 403])(
    'never retries auth HTTP %s even when it mentions options',
    async (status) => {
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          throw apiError(status, 'Unsupported thinking and response_format');
        },
      });
      expect((await run(model, `auth-${status}`)).ok).toBe(false);
      expect(model.doGenerateCalls).toHaveLength(1);
    },
  );
  it('retries a length-truncated JSON response with 4096 tokens', async () => {
    let attempt = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        ++attempt === 1
          ? { ...okResult(''), content: [], finishReason: { unified: 'length', raw: 'max_tokens' } }
          : okResult('{"title":"More room"}'),
    });
    expect(await run(model, 'length-json')).toEqual({ ok: true, value: 'More room' });
    expect(model.doGenerateCalls.map((c) => c.maxOutputTokens)).toEqual([1024, 4096]);
  });
  it('handles NoOutputGeneratedError with length, but never loops on length failures', async () => {
    let attempts = 0;
    const chosen = { ...credential, model: { ...credential.model, id: 'no-output-length' } };
    await expect(
      withModelSettings(chosen, 5000, async ({ maxOutputTokens }) => {
        attempts += 1;
        expect(maxOutputTokens).toBe(attempts === 1 ? 1024 : 4096);
        throw new NoOutputGeneratedError({
          cause: Object.assign(new Error('no JSON'), { finishReason: 'length' }),
        });
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(2);
  });
  it('gives a length retry only the time left in the original deadline', async () => {
    let now = 0;
    let attempt = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const chosen = { ...credential, model: { ...credential.model, id: 'length-deadline' } };
    try {
      const result = await withModelSettings(chosen, 5000, async (settings) => {
        expect(settings.timeout).toEqual({ totalMs: attempt === 0 ? 5000 : 1000 });
        if (++attempt === 1) {
          now = 4000;
          throw new NoOutputGeneratedError({
            cause: Object.assign(new Error('length'), { finishReason: 'length' }),
          });
        }
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(attempt).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });
  it('retries a Gateway-wrapped unsupported option from its HTTP error cause', async () => {
    let attempt = 0;
    const chosen = {
      ...credential,
      kind: 'gateway' as const,
      model: {
        ...credential.model,
        id: 'wrapped-gateway',
        reasoning: { type: 'gateway' as const, effort: 'low' as const },
      },
    };
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (++attempt === 1)
          throw Object.assign(new Error('Invalid request'), {
            name: 'GatewayInvalidRequestError',
            statusCode: 400,
            cause: apiError(400, 'Unsupported reasoning'),
          });
        return okResult('ok');
      },
    });
    await withModelSettings(chosen, 5000, ({ structuredOutput: _format, ...settings }) =>
      generateText({ model, prompt: 'hi', maxRetries: 0, ...settings }),
    );
    expect(model.doGenerateCalls.map((c) => c.reasoning)).toEqual(['low', undefined]);
  });
});
