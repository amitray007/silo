import { describe, expect, it } from 'vitest';
import { type AiLiveModel, defaultModelFor } from './model-types.js';

const model = (id: string, createdAt = '2026-10-01T00:00:00Z'): AiLiveModel => ({
  id,
  label: id,
  createdAt,
  structuredOutput: 'unknown',
  reasoning: { type: 'openai' },
});
describe('live-list default rules', () => {
  it.each([
    ['anthropic', ['claude-opus-5-5', 'claude-haiku-4-5', 'claude-haiku-5-5'], 'claude-haiku-5-5'],
    ['openai', ['gpt-6-astra', 'gpt-5-mini', 'gpt-6-luna'], 'gpt-6-luna'],
    ['openai', ['gpt-6-astra', 'gpt-5-nano', 'gpt-5-mini'], 'gpt-5-mini'],
    ['openai', ['gpt-6-astra', 'gpt-5-nano'], 'gpt-5-nano'],
    [
      'gateway',
      ['google/gemini-3.5-flash', 'openai/gpt-6-luna', 'anthropic/claude-haiku-5.5'],
      'anthropic/claude-haiku-5.5',
    ],
    ['gateway', ['google/gemini-3.5-flash', 'openai/gpt-6-luna'], 'openai/gpt-6-luna'],
    [
      'gateway',
      ['google/gemini-3.5-flash', 'anthropic/claude-opus-5.5'],
      'google/gemini-3.5-flash',
    ],
    [
      'fireworks',
      ['other', 'accounts/fireworks/models/glm-5p3-flash'],
      'accounts/fireworks/models/glm-5p3-flash',
    ],
  ] as const)('%s prefers its first available family', (kind, ids, expected) => {
    expect(
      defaultModelFor(
        kind,
        ids.map((id) => model(id)),
      )?.id,
    ).toBe(expected);
  });
  it.each(['anthropic', 'openai', 'gateway', 'fireworks'] as const)(
    '%s falls back to the newest model and handles an empty list',
    (kind) => {
      expect(defaultModelFor(kind, [model('new', '2026-10-05T00:00:00Z'), model('old')])?.id).toBe(
        'new',
      );
      expect(defaultModelFor(kind, [])).toBeUndefined();
    },
  );
  it('uses dates ahead of name order inside a preferred family', () => {
    expect(
      defaultModelFor('openai', [model('gpt-8-luna'), model('gpt-7-luna', '2026-10-05T00:00:00Z')])
        ?.id,
    ).toBe('gpt-7-luna');
  });
});
