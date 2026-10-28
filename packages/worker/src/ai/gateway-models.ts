import type { AiLiveModel } from '@silo/core';
import type { AiModelsFetcher } from '@silo/core/ai-credential';
import { z } from 'zod';
import { createModelListFetcher } from './model-list.js';

const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const optionSchema = z.object({
  type: z.string(),
  values: z.array(z.string()).optional(),
  min: z.number().int().nonnegative().optional(),
});
const modelSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().min(1).max(256),
  type: z.string(),
  owned_by: z.string().min(1).max(128).optional(),
  created: z.number().nonnegative().optional(),
  released: z.number().nonnegative().optional(),
  context_window: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  tags: z.array(z.string()),
  reasoning_options: z.array(optionSchema).optional(),
  eligible: z.boolean().optional(),
  eligibility: z.object({ eligible: z.boolean() }).optional(),
  deprecated_at: z.union([z.number(), z.string()]).nullish(),
  deprecated: z.boolean().optional(),
  deprecation_date: z.string().nullish(),
});
const pageSchema = z.object({ data: z.array(z.unknown()) });

function reasoning(options: z.infer<typeof optionSchema>[]): AiLiveModel['reasoning'] {
  if (options.some((o) => o.type === 'toggle')) return { type: 'gateway', effort: 'none' };
  const values = options.find((o) => o.type === 'effort')?.values ?? [];
  const effort = effortOrder.find((value) => values.includes(value));
  if (effort) return { type: 'gateway', effort };
  const budget = options.find((o) => o.type === 'budget_tokens');
  return { type: 'gateway', ...(budget ? { budgetTokens: budget.min ?? 1 } : {}) };
}

function usable(m: z.infer<typeof modelSchema>): boolean {
  return (
    m.type === 'language' &&
    m.tags.includes('structured-output') &&
    m.eligible !== false &&
    m.eligibility?.eligible !== false &&
    m.deprecated_at == null &&
    !m.deprecated &&
    !m.tags.includes('deprecated') &&
    (!m.deprecation_date || Date.parse(m.deprecation_date) >= Date.now())
  );
}

/** Stored refreshes always request eligibility with the owner key. */
export function createGatewayModelsFetcher(fetch: typeof globalThis.fetch): AiModelsFetcher {
  return createModelListFetcher(fetch, {
    url: () => new URL('https://ai-gateway.vercel.sh/v1/models?include_availability'),
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    maxBytes: 4 * 1024 * 1024,
    page: (raw) => ({ entries: pageSchema.parse(raw).data }),
    model: (raw) => {
      const parsed = modelSchema.safeParse(raw);
      if (!parsed.success) return undefined;
      const m = parsed.data;
      if (!usable(m)) return undefined;
      const created = m.released ?? m.created;
      return {
        id: m.id,
        label: m.name,
        ...(m.owned_by ? { owner: m.owned_by } : {}),
        ...(created ? { createdAt: new Date(created * 1000).toISOString() } : {}),
        ...(m.context_window ? { contextWindow: m.context_window } : {}),
        ...(m.max_tokens ? { maxOutputTokens: m.max_tokens } : {}),
        structuredOutput: 'native',
        reasoning: reasoning(m.reasoning_options ?? []),
      };
    },
  });
}
