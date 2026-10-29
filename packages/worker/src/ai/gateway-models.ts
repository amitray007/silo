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
  model_eligibility: z.object({ status: z.enum(['eligible', 'ineligible', 'unknown']) }).optional(),
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
    (!m.model_eligibility || m.model_eligibility.status === 'eligible') &&
    m.deprecated_at == null &&
    !m.deprecated &&
    !m.tags.includes('deprecated') &&
    (!m.deprecation_date || Date.parse(m.deprecation_date) >= Date.now())
  );
}

/** Stored refreshes always request eligibility with the owner key. */
export function createGatewayModelsFetcher(fetch: typeof globalThis.fetch): AiModelsFetcher {
  return async (key) => {
    let annotated = false;
    return createModelListFetcher(fetch, {
      url: () => new URL('https://ai-gateway.vercel.sh/v1/models?include_availability'),
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
      maxBytes: 4 * 1024 * 1024,
      page: (raw) => {
        const entries = pageSchema.parse(raw).data;
        annotated = entries.some(
          (entry) => typeof entry === 'object' && entry !== null && 'model_eligibility' in entry,
        );
        return { entries };
      },
      model: (raw) => gatewayModel(raw, annotated),
    })(key);
  };
}

function gatewayModel(raw: unknown, annotated: boolean): AiLiveModel | undefined {
  const parsed = modelSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const m = parsed.data;
  if (!usable(m) || (annotated && m.model_eligibility?.status !== 'eligible')) return undefined;
  const created = m.released ?? m.created;
  return {
    id: m.id,
    label: m.name,
    ...(m.owned_by ? { owner: m.owned_by } : {}),
    ...(created ? { createdAt: new Date(created * 1000).toISOString() } : {}),
    ...(m.context_window ? { contextWindow: m.context_window } : {}),
    ...(m.max_tokens ? { maxOutputTokens: m.max_tokens } : {}),
    structuredOutput: 'native',
    eligibility: m.model_eligibility?.status === 'eligible' ? 'eligible' : 'unverified',
    reasoning: reasoning(m.reasoning_options ?? []),
  };
}
