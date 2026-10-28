import type { AiLiveModel } from '@silo/core';
import type { AiModelsFetcher } from '@silo/core/ai-credential';
import { z } from 'zod';
import { createModelListFetcher } from './model-list.js';

const support = z.object({ supported: z.boolean() });
const capabilities = z.object({
  structured_outputs: support.nullish(),
  thinking: z.object({ types: z.record(z.string(), support.nullish()).nullish() }).nullish(),
  effort: z.record(z.string(), z.unknown()).nullish(),
});
const modelSchema = z.object({
  id: z.string().min(1).max(512),
  display_name: z.string().min(1).max(256),
  created_at: z.iso.datetime({ offset: true }).optional(),
  lifecycle: z.string().nullish(),
  retires_at: z.string().nullish(),
  max_input_tokens: z.number().int().positive().nullish(),
  max_tokens: z.number().int().positive().nullish(),
  capabilities: capabilities.nullish(),
});
const pageSchema = z.object({
  data: z.array(z.unknown()),
  last_id: z.string().nullish(),
  has_more: z.boolean(),
});
const THINKING_ORDER = ['disabled', 'between_tools', 'adaptive', 'enabled'] as const;
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

function normalize(raw: unknown): AiLiveModel | undefined {
  const parsed = modelSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const m = parsed.data;
  if (m.lifecycle && m.lifecycle !== 'active') return undefined;
  if (!m.lifecycle && m.retires_at && Date.parse(m.retires_at) < Date.now()) return undefined;
  if (m.capabilities?.structured_outputs?.supported === false) return undefined;
  const thinking = THINKING_ORDER.find(
    (mode) => m.capabilities?.thinking?.types?.[mode]?.supported,
  );
  const effort = EFFORT_ORDER.find(
    (level) => support.safeParse(m.capabilities?.effort?.[level]).data?.supported,
  );
  return {
    id: m.id,
    label: m.display_name,
    owner: 'anthropic',
    ...(m.created_at ? { createdAt: m.created_at } : {}),
    ...(m.max_input_tokens ? { contextWindow: m.max_input_tokens } : {}),
    ...(m.max_tokens ? { maxOutputTokens: m.max_tokens } : {}),
    structuredOutput: m.capabilities?.structured_outputs?.supported ? 'native' : 'unknown',
    reasoning: {
      type: 'anthropic',
      ...(thinking ? { thinking } : {}),
      ...(effort ? { effort } : {}),
    },
  };
}

export function createAnthropicModelsFetcher(fetch: typeof globalThis.fetch): AiModelsFetcher {
  return createModelListFetcher(fetch, {
    url: (token) => {
      const url = new URL('https://api.anthropic.com/v1/models');
      url.searchParams.set('limit', '1000');
      if (token) url.searchParams.set('after_id', token);
      return url;
    },
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2026-10-21' }),
    page: (raw) => {
      const page = pageSchema.parse(raw);
      if (page.has_more && !page.last_id) throw new Error('Missing page cursor');
      return { entries: page.data, next: page.has_more ? (page.last_id ?? undefined) : undefined };
    },
    model: normalize,
  });
}
