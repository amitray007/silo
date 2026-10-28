import type { AiProviderKind, AiSettingsResponse, SettingsMap } from '../api/types';

export const AI_PROVIDER_NAMES: Record<AiProviderKind, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gateway: 'Vercel AI Gateway',
  fireworks: 'Fireworks',
};
export const AI_PROVIDER_ORDER: AiProviderKind[] = ['anthropic', 'openai', 'gateway', 'fireworks'];

export function readableAiProviders(ai: AiSettingsResponse) {
  return AI_PROVIDER_ORDER.filter((kind) =>
    ai.providers.some((p) => p.kind === kind && p.configured && p.keyReadable),
  );
}

/** Used only when the owner enables a feature that has no model yet. */
export function defaultAiFeatureModel(ai: AiSettingsResponse) {
  for (const provider of readableAiProviders(ai)) {
    const models = ai.providers.find((p) => p.kind === provider)?.models ?? [];
    const id =
      provider === 'fireworks'
        ? (models.find((m) => m.id === 'accounts/fireworks/models/glm-5p3-flash') ?? models[0])?.id
        : ai.catalog.find((m) => m.defaultFor.includes(provider))?.id;
    if (id) return { provider, id };
  }
  return null;
}

export function aiModelLabel(
  ai: AiSettingsResponse,
  model: SettingsMap['ai']['features'][string]['model'],
) {
  if (!model) return null;
  const label =
    model.provider === 'fireworks'
      ? ai.providers.find((p) => p.kind === 'fireworks')?.models?.find((m) => m.id === model.id)
          ?.label
      : ai.catalog.find((m) => m.id === model.id)?.label;
  return `${label ?? model.id} via ${AI_PROVIDER_NAMES[model.provider]}`;
}
