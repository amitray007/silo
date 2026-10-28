import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { languageModelFor } from './model.js';
import { credential } from './test-helpers.js';

describe('languageModelFor', () => {
  it('builds a model per provider kind', () => {
    const anthropic = languageModelFor(credential);
    expect(anthropic).toMatchObject({ modelId: 'claude-haiku-5-5' });
    const gateway = languageModelFor({ ...credential, kind: 'gateway' });
    expect(gateway).toMatchObject({ modelId: 'anthropic/claude-haiku-5.5' });
    const openai = languageModelFor({
      kind: 'openai',
      apiKey: 'sk-test-0000',
      model: { ...credential.model, openaiId: 'gpt-x' },
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
            model: { ...credential.model, openaiId: 'gpt-x' },
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
});
