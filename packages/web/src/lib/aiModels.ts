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
    const id = ai.providers.find((p) => p.kind === provider)?.defaultModel;
    if (id) return { provider, id };
  }
  return null;
}

export function aiModelLabel(
  ai: AiSettingsResponse,
  model: SettingsMap['ai']['features'][string]['model'],
) {
  if (!model) return null;
  const label = ai.providers
    .find((p) => p.kind === model.provider)
    ?.models?.find((m) => m.id === model.id)?.label;
  return `${label ?? model.id} via ${AI_PROVIDER_NAMES[model.provider]}`;
}
