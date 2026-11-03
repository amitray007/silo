import type { AiProviderKind, AiSettingsResponse, SettingsMap } from '../api/types';

export const AI_PROVIDER_NAMES: Record<AiProviderKind, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gateway: 'Vercel AI Gateway',
  fireworks: 'Fireworks',
};
export const AI_PROVIDER_ORDER: AiProviderKind[] = ['anthropic', 'openai', 'gateway', 'fireworks'];

function readableAiProviders(ai: AiSettingsResponse) {
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

/** Both settings tabs use the same gate when enabling plugin AI features. */
export function pluginAiReadiness(ai: AiSettingsResponse | undefined) {
  const enabled = ai?.status?.enabled === true && ai.status.secretKey === 'ok';
  return {
    ready: enabled && ai !== undefined && defaultAiFeatureModel(ai) !== null,
    hint: enabled ? 'Add a provider key and model in the AI tab' : 'Turn on AI in the AI tab',
  };
}
