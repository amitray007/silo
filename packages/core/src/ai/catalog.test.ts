import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_CATALOG,
  defaultModelFor,
  modelsForProvider,
  providerModelId,
  resolveModel,
} from './catalog.js';

describe('model catalog', () => {
  it('has 8 models with unique ids', () => {
    expect(AI_MODEL_CATALOG).toHaveLength(8);
    expect(new Set(AI_MODEL_CATALOG.map((m) => m.id)).size).toBe(8);
  });

  it('every entry has the ids its family needs', () => {
    for (const entry of AI_MODEL_CATALOG) {
      expect(entry.gatewayId).toMatch(/^(anthropic|openai)\//);
      if (entry.family === 'claude') expect(entry.anthropicId).toBeTruthy();
      else expect(entry.openaiId).toBeTruthy();
    }
  });

  it('lists the models each provider reaches', () => {
    expect(modelsForProvider('anthropic').every((m) => m.family === 'claude')).toBe(true);
    expect(modelsForProvider('anthropic')).toHaveLength(4);
    expect(modelsForProvider('openai').every((m) => m.family === 'chatgpt')).toBe(true);
    expect(modelsForProvider('openai')).toHaveLength(4);
    expect(modelsForProvider('gateway')).toHaveLength(8);
  });

  it('defaults to the fast model of the family, Claude Haiku 5.5 for the gateway', () => {
    expect(defaultModelFor('anthropic').id).toBe('claude-haiku-5-5');
    expect(defaultModelFor('openai').id).toBe('gpt-6-luna');
    expect(defaultModelFor('gateway').id).toBe('claude-haiku-5-5');
  });

  it('resolveModel keeps a reachable model', () => {
    const { entry, fellBack } = resolveModel('gateway', 'gpt-6-astra');
    expect(entry.id).toBe('gpt-6-astra');
    expect(fellBack).toBe(false);
  });

  it('resolveModel falls back for null, unknown and unreachable ids', () => {
    expect(resolveModel('anthropic', null)).toMatchObject({
      entry: { id: 'claude-haiku-5-5' },
      fellBack: false,
    });
    expect(resolveModel('anthropic', 'retired-model')).toMatchObject({
      entry: { id: 'claude-haiku-5-5' },
      fellBack: true,
    });
    expect(resolveModel('openai', 'claude-opus-5-5')).toMatchObject({
      entry: { id: 'gpt-6-luna' },
      fellBack: true,
    });
  });

  it('providerModelId picks the direct or gateway id and rejects an unreachable pair', () => {
    const haiku = defaultModelFor('anthropic');
    expect(providerModelId(haiku, 'anthropic')).toBe('claude-haiku-5-5');
    expect(providerModelId(haiku, 'gateway')).toBe('anthropic/claude-haiku-5.5');
    expect(() => providerModelId(haiku, 'openai')).toThrow();
    expect(providerModelId(defaultModelFor('openai'), 'openai')).toBe('gpt-6-luna');
  });
});
