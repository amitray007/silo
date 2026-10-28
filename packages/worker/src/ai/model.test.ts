import { generateText, Output } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { languageModelFor } from './model.js';
import { credential } from './test-helpers.js';

describe('languageModelFor', () => {
  it('builds a model per provider kind', () => {
    const anthropic = languageModelFor(credential);
    expect(anthropic).toMatchObject({ modelId: 'claude-haiku-5-5' });
    const gateway = languageModelFor({
      ...credential,
      kind: 'gateway',
      model: { ...credential.model, id: 'anthropic/claude-haiku-5.5' },
    });
    expect(gateway).toMatchObject({ modelId: 'anthropic/claude-haiku-5.5' });
    const openai = languageModelFor({
      kind: 'openai',
      apiKey: 'sk-test-0000',
      model: { ...credential.model, id: 'gpt-x' },
    });
    expect(openai).toMatchObject({ modelId: 'gpt-x' });
  });

  it('throws on an empty or blank key, never falling back to the environment', () => {
    process.env.ANTHROPIC_API_KEY = 'env-key-should-not-be-used';
    try {
      expect(() => languageModelFor({ ...credential, apiKey: '' })).toThrow('empty');
      expect(() => languageModelFor({ ...credential, apiKey: '   ' })).toThrow('empty');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it.each([
    ['anthropic', 'ANTHROPIC_BASE_URL', 'https://api.anthropic.com/v1/messages'],
    ['openai', 'OPENAI_BASE_URL', 'https://api.openai.com/v1/'],
  ] as const)(
    'sends %s requests to the official host despite %s',
    async (kind, variable, expected) => {
      process.env[variable] = 'https://evil.example.com/v1';
      const urls: string[] = [];
      const fetch = (async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return new Response('{}', { status: 500 });
      }) as typeof globalThis.fetch;
      try {
        const model = languageModelFor(
          {
            kind,
            apiKey: 'sk-test-0000',
            model: { ...credential.model, id: 'gpt-x' },
          },
          fetch,
        );
        await generateText({ model, prompt: 'hi', maxRetries: 0 }).catch(() => undefined);
      } finally {
        delete process.env[variable];
      }
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]?.startsWith(expected)).toBe(true);
    },
  );
  it('sends Fireworks JSON schema, low reasoning and the token budget to the fixed host', async () => {
    process.env.FIREWORKS_BASE_URL = 'https://evil.example.com/v1';
    process.env.FIREWORKS_API_KEY = 'env-key-never-use';
    let sentUrl = '';
    let sentBody: Record<string, unknown> = {};
    let sentHeaders: Headers | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      sentUrl = String(input);
      sentBody = JSON.parse(String(init?.body));
      sentHeaders = new Headers(init?.headers);
      return new Response('{}', { status: 500 });
    };
    try {
      const model = languageModelFor(
        {
          kind: 'fireworks',
          apiKey: 'fake-fireworks-key',
          model: {
            id: 'accounts/fireworks/models/glm-5p3-flash',
            label: 'GLM',
            contextWindow: 200000,
            structuredOutput: 'native',
            reasoning: { type: 'fireworks' },
          },
        },
        fetch,
      );
      expect(model).toMatchObject({ specificationVersion: 'v4' });
      await generateText({
        model,
        prompt: 'hi',
        output: Output.object({ schema: z.object({ title: z.string() }) }),
        providerOptions: { fireworks: { reasoningEffort: 'low' } },
        maxOutputTokens: 1024,
        maxRetries: 0,
      }).catch(() => undefined);
      expect(sentUrl).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
      expect(sentHeaders?.get('authorization')).toBe('Bearer fake-fireworks-key');
      expect(sentBody.model).toBe('accounts/fireworks/models/glm-5p3-flash');
      expect(sentBody.response_format).toMatchObject({ type: 'json_schema' });
      expect(sentBody.reasoning_effort).toBe('low');
      expect(sentBody.max_tokens).toBe(1024);
      expect(sentBody).not.toHaveProperty('reasoning');
    } finally {
      delete process.env.FIREWORKS_BASE_URL;
      delete process.env.FIREWORKS_API_KEY;
    }
  });
});
