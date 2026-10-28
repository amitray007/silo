import { getAiSettingForStatus, type getSetting } from '../settings/settings.js';
import { AI_FEATURES, type AiFeatureId } from './features.js';
import { storedProviderList } from './model-store.js';
import { type AiLiveModel, type AiProviderKind, defaultModelFor } from './model-types.js';
import { storedProviderModels } from './models.js';
import { readAiProviderKey } from './providers.js';
import { secretKeyStatus } from './secret-box.js';

export type AiNotReadyReason =
  | 'disabled'
  | 'feature_disabled'
  | 'no_secret_key'
  | 'no_model'
  | 'list_not_loaded'
  | 'no_key'
  | 'key_unreadable';
export type AiFeatureStatus = {
  ready: boolean;
  reason: AiNotReadyReason | null;
  provider: AiProviderKind | null;
  model: string | null;
};
export type AiStatus = {
  enabled: boolean;
  secretKey: 'ok' | 'missing' | 'invalid';
  features: Record<AiFeatureId, AiFeatureStatus>;
};
export type AiCredential = { kind: AiProviderKind; apiKey: string; model: AiLiveModel };

/** Explicit selection only. Defaults are reserved for connection tests. */
export async function resolveAiCredential(
  kind: AiProviderKind,
  modelId?: string,
): Promise<AiCredential | undefined> {
  return (await resolveWithBlob(kind, modelId))?.credential;
}

export async function resolveWithBlob(
  kind: AiProviderKind,
  modelId?: string,
): Promise<{ credential: AiCredential; encryptedKey: string } | undefined> {
  if (secretKeyStatus() !== 'ok') return undefined;
  const key = await readAiProviderKey(kind);
  if (key.state !== 'ok') return undefined;
  const models = await storedProviderModels(kind);
  const model =
    modelId === undefined
      ? defaultModelFor(kind, models)
      : models.find((entry) => entry.id === modelId);
  if (!model) return undefined;
  return { credential: { kind, apiKey: key.apiKey, model }, encryptedKey: key.encryptedKey };
}

async function featureStatus(
  ai: Awaited<ReturnType<typeof getSetting<'ai'>>>,
  id: AiFeatureId,
): Promise<AiFeatureStatus> {
  const feature = ai.features[id];
  const model = feature.model;
  const list = model ? await storedProviderList(model.provider) : { models: [], fetchedAt: null };
  const matched = list.models.find((entry) => entry.id === model?.id);
  const base = { provider: model?.provider ?? null, model: matched?.id ?? null };
  let reason: AiNotReadyReason | null = null;
  if (!ai.enabled) reason = 'disabled';
  else if (secretKeyStatus() !== 'ok') reason = 'no_secret_key';
  else if (!feature.enabled) reason = 'feature_disabled';
  else if (!model) reason = 'no_model';
  else reason = await selectionReason(model.provider, list, matched !== undefined);
  return {
    ...base,
    ready: reason === null,
    reason,
  };
}

async function selectionReason(
  kind: AiProviderKind,
  list: Awaited<ReturnType<typeof storedProviderList>>,
  matched: boolean,
): Promise<AiNotReadyReason | null> {
  const key = await readAiProviderKey(kind);
  if (key.state !== 'ok') return key.state;
  if (!list.models.length && !list.fetchedAt) return 'list_not_loaded';
  return matched ? null : 'no_model';
}

/** Adapter-safe status; keys never leave the protected credential subpath. */
export async function aiStatus(): Promise<AiStatus> {
  const ai = await getAiSettingForStatus();
  const features = {} as Record<AiFeatureId, AiFeatureStatus>;
  for (const feature of AI_FEATURES) features[feature.id] = await featureStatus(ai, feature.id);
  return { enabled: ai.enabled, secretKey: secretKeyStatus(), features };
}

export async function resolveAiFeatureCredential(
  id: AiFeatureId,
): Promise<AiCredential | undefined> {
  const ai = await getAiSettingForStatus();
  if (!(await featureStatus(ai, id)).ready) return undefined;
  const model = ai.features[id].model;
  return model ? resolveAiCredential(model.provider, model.id) : undefined;
}

export async function isAiFeatureOn(id: AiFeatureId): Promise<boolean> {
  return (await aiStatus()).features[id].ready;
}
