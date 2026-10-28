import { z } from 'zod';

export const AI_PROVIDER_KINDS = ['anthropic', 'openai', 'gateway', 'fireworks'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

const effort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const reasoningSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('anthropic'),
    thinking: z.enum(['disabled', 'between_tools', 'adaptive', 'enabled']).optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  }),
  z.object({ type: z.literal('openai'), effort: effort.optional() }),
  z.object({
    type: z.literal('gateway'),
    effort: effort.optional(),
    budgetTokens: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('fireworks') }),
]);

export const liveModelSchema = z.object({
  id: z.string().min(1).max(512),
  label: z.string().min(1).max(256),
  owner: z.string().min(1).max(128).optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  structuredOutput: z.enum(['native', 'unknown']),
  reasoning: reasoningSchema,
});
export type AiLiveModel = z.infer<typeof liveModelSchema>;

/** Dates decide recency; numeric ids break ties for providers without creation dates. */
export function newestModels(models: readonly AiLiveModel[]): AiLiveModel[] {
  return [...models].sort(
    (a, b) =>
      Date.parse(b.createdAt ?? '1970-01-01') - Date.parse(a.createdAt ?? '1970-01-01') ||
      b.id.localeCompare(a.id, 'en', { numeric: true }),
  );
}

/** Defaults are for connection tests and newly enabled features, never failed selections. */
export function defaultModelFor(
  kind: AiProviderKind,
  models: readonly AiLiveModel[],
): AiLiveModel | undefined {
  const sorted = newestModels(models);
  if (kind === 'fireworks') {
    return sorted.find((m) => m.id === 'accounts/fireworks/models/glm-5p3-flash') ?? sorted[0];
  }
  const families = {
    anthropic: ['haiku'],
    openai: ['luna', 'mini', 'nano'],
    gateway: ['haiku', 'luna', 'flash'],
  };
  for (const family of families[kind]) {
    const match = sorted.find((m) => new RegExp(`(?:^|[-/])${family}(?:[-./]|$)`, 'i').test(m.id));
    if (match) return match;
  }
  return sorted[0];
}
