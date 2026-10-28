/**
 * The curated model list (AI foundation). A code constant: the owner picks
 * from it, there is no free-text model ID. Updating the list is a one-file
 * change plus its test.
 *
 * `reasoning` is the lowest setting the model accepts, so short tasks stay fast.
 * `anthropicId`/`openaiId` are the IDs for the direct provider; `gatewayId` is
 * the Vercel AI Gateway ID, which reaches every model.
 */

export const AI_PROVIDER_KINDS = ['anthropic', 'openai', 'gateway', 'fireworks'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export type CatalogEntry = {
  id: string;
  family: 'claude' | 'chatgpt';
  label: string;
  tier: 'fast' | 'balanced' | 'best';
  anthropicId?: string;
  openaiId?: string;
  gatewayId: string;
  reasoning: 'none' | 'low';
};

export const AI_MODEL_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'claude-haiku-5-5',
    family: 'claude',
    label: 'Claude Haiku 5.5',
    tier: 'fast',
    anthropicId: 'claude-haiku-5-5',
    gatewayId: 'anthropic/claude-haiku-5.5',
    reasoning: 'none',
  },
  {
    id: 'claude-sonnet-5-5',
    family: 'claude',
    label: 'Claude Sonnet 5.5',
    tier: 'balanced',
    anthropicId: 'claude-sonnet-5-5',
    gatewayId: 'anthropic/claude-sonnet-5.5',
    reasoning: 'low',
  },
  {
    id: 'claude-opus-5-5',
    family: 'claude',
    label: 'Claude Opus 5.5',
    tier: 'best',
    anthropicId: 'claude-opus-5-5',
    gatewayId: 'anthropic/claude-opus-5.5',
    reasoning: 'low',
  },
  {
    id: 'claude-fable-5-1',
    family: 'claude',
    label: 'Claude Fable 5.1',
    tier: 'best',
    anthropicId: 'claude-fable-5-1',
    gatewayId: 'anthropic/claude-fable-5.1',
    reasoning: 'low',
  },
  {
    id: 'gpt-6-luna',
    family: 'chatgpt',
    label: 'GPT-6 Luna',
    tier: 'fast',
    openaiId: 'gpt-6-luna',
    gatewayId: 'openai/gpt-6-luna',
    reasoning: 'none',
  },
  {
    id: 'gpt-6.1-terra',
    family: 'chatgpt',
    label: 'GPT-6.1 Terra',
    tier: 'balanced',
    openaiId: 'gpt-6.1-terra',
    gatewayId: 'openai/gpt-6.1-terra',
    reasoning: 'none',
  },
  {
    id: 'gpt-6.1-sol',
    family: 'chatgpt',
    label: 'GPT-6.1 Sol',
    tier: 'balanced',
    openaiId: 'gpt-6.1-sol',
    gatewayId: 'openai/gpt-6.1-sol',
    reasoning: 'low',
  },
  {
    id: 'gpt-6-astra',
    family: 'chatgpt',
    label: 'GPT-6 Astra',
    tier: 'best',
    openaiId: 'gpt-6-astra',
    gatewayId: 'openai/gpt-6-astra',
    reasoning: 'low',
  },
];

/** Which catalog family each provider reaches. `all` means every family (the gateway). */
const PROVIDER_FAMILY: Record<AiProviderKind, CatalogEntry['family'] | 'all' | 'live'> = {
  anthropic: 'claude',
  openai: 'chatgpt',
  gateway: 'all',
  fireworks: 'live',
};

/** Catalog entries a provider can reach: Anthropic -> Claude, OpenAI -> ChatGPT, Gateway -> all. */
export function modelsForProvider(kind: AiProviderKind): CatalogEntry[] {
  const family = PROVIDER_FAMILY[kind];
  return AI_MODEL_CATALOG.filter((entry) => family === 'all' || entry.family === family);
}

/** The provider's default: the fast model it reaches, first in catalog order (Gateway: Claude Haiku 5.5). */
export function defaultModelFor(kind: AiProviderKind): CatalogEntry {
  const entry = modelsForProvider(kind).find((e) => e.tier === 'fast');
  if (!entry) throw new Error(`catalog has no fast model for ${kind}`);
  return entry;
}

/**
 * Resolves the model a provider should use. A null, unknown, or unreachable
 * `modelId` falls back to the provider's default and sets `fellBack`, so the UI
 * can say so.
 */
export function resolveModel(
  kind: AiProviderKind,
  modelId: string | null,
): { entry: CatalogEntry; fellBack: boolean } {
  const match = modelId ? modelsForProvider(kind).find((entry) => entry.id === modelId) : undefined;
  if (match) return { entry: match, fellBack: false };
  return { entry: defaultModelFor(kind), fellBack: modelId !== null };
}

/** The model ID to send to `kind`: the gateway ID for Gateway, else the direct ID. */
export type AiLiveModel = {
  id: string;
  label: string;
  contextLength: number | null;
  reasoning?: never;
};
export type AiModel = CatalogEntry | AiLiveModel;

export function defaultFireworksModel(models: readonly AiLiveModel[]): AiLiveModel | undefined {
  return models.find((m) => m.id === 'accounts/fireworks/models/glm-5p3-flash') ?? models[0];
}

export function providerModelId(entry: AiModel, kind: AiProviderKind): string {
  if (kind === 'fireworks') return entry.id;
  if (!('gatewayId' in entry)) throw new Error('Live model requires Fireworks');
  if (kind === 'gateway') return entry.gatewayId;
  const id = kind === 'anthropic' ? entry.anthropicId : entry.openaiId;
  if (!id) throw new Error(`${entry.id} is not reachable by ${kind}`);
  return id;
}
