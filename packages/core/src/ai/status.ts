import { getSetting } from '../settings/settings.js';
import { type AiProviderKind, type CatalogEntry, resolveModel } from './catalog.js';
import type { AiFeatureId } from './features.js';
import { type AiKeyRead, readAiProviderKey } from './providers.js';
import { secretKeyStatus } from './secret-box.js';

export type AiNotReadyReason =
  | 'disabled'
  | 'no_secret_key'
  | 'no_provider'
  | 'no_key'
  | 'key_unreadable';

export type AiStatus = {
  enabled: boolean;
  secretKey: 'ok' | 'missing' | 'invalid';
  provider: AiProviderKind | null;
  model: { id: string; fellBack: boolean } | null;
  ready: boolean;
  reason?: AiNotReadyReason;
};

type AiSetting = Awaited<ReturnType<typeof getSetting<'ai'>>>;
type ReadyKey = Extract<AiKeyRead, { state: 'ok' }>;

/** One read of the setting and (when it gets that far) the key, shared by `aiStatus` and `resolveAiCredential`. */
async function evaluate(): Promise<{ status: AiStatus; ai: AiSetting; key?: ReadyKey }> {
  const ai = await getSetting('ai');
  const secretKey = secretKeyStatus();
  const resolved = ai.provider ? resolveModel(ai.provider, ai.model) : undefined;
  const base = {
    enabled: ai.enabled,
    secretKey,
    provider: ai.provider,
    model: resolved ? { id: resolved.entry.id, fellBack: resolved.fellBack } : null,
  };
  const notReady = (reason: AiNotReadyReason) => ({
    ai,
    status: { ...base, ready: false, reason } satisfies AiStatus,
  });

  if (!ai.enabled) return notReady('disabled');
  if (secretKey !== 'ok') return notReady('no_secret_key');
  if (!ai.provider) return notReady('no_provider');
  const read = await readAiProviderKey(ai.provider);
  if (read.state !== 'ok') return notReady(read.state);
  return { ai, key: read, status: { ...base, ready: true } };
}

/**
 * Whether AI is usable, and if not, why. SAFE for adapters: it never contains
 * key material. The first failing check wins, in this order: disabled,
 * no_secret_key, no_provider, no_key, key_unreadable.
 */
export async function aiStatus(): Promise<AiStatus> {
  return (await evaluate()).status;
}

export type AiCredential = { kind: AiProviderKind; apiKey: string; model: CatalogEntry };

/**
 * The decrypted credential, for the worker and the connection test ONLY.
 * Adapters (api, web, mcp) must never call this, serialize its result, or log
 * it: it holds the plaintext API key. Use `aiStatus()` for anything an adapter
 * shows.
 *
 * With no `kindOverride`, returns a credential only when `aiStatus().ready`.
 * With one, ignores `ai.enabled` and uses that kind's stored key, so a key can
 * be tested before AI is switched on; the model is the setting's model when it
 * belongs to that kind, else the kind's default.
 */
export async function resolveAiCredential(
  kindOverride?: AiProviderKind,
): Promise<AiCredential | undefined> {
  return (await resolveWithBlob(kindOverride))?.credential;
}

/**
 * Like `resolveAiCredential`, but also returns the ciphertext that was
 * decrypted, so a caller can tell later whether the stored key changed.
 * INTERNAL to the AI layer (`tester.ts`); the blob never goes in `AiCredential`.
 */
export async function resolveWithBlob(
  kindOverride?: AiProviderKind,
): Promise<{ credential: AiCredential; encryptedKey: string } | undefined> {
  let ai: AiSetting;
  let kind: AiProviderKind | null;
  let key: ReadyKey | undefined;
  if (kindOverride) {
    ai = await getSetting('ai');
    kind = kindOverride;
    if (secretKeyStatus() !== 'ok') return undefined;
    const read = await readAiProviderKey(kindOverride);
    key = read.state === 'ok' ? read : undefined;
  } else {
    const evaluated = await evaluate();
    ai = evaluated.ai;
    kind = ai.provider;
    key = evaluated.status.ready ? evaluated.key : undefined;
  }
  if (!kind || !key) return undefined;
  const { entry } = resolveModel(kind, ai.provider === kind ? ai.model : null);
  return { credential: { kind, apiKey: key.apiKey, model: entry }, encryptedKey: key.encryptedKey };
}

/** `true` when AI is ready and the owner switched this feature on. */
export async function isAiFeatureOn(id: AiFeatureId): Promise<boolean> {
  const [ai, status] = await Promise.all([getSetting('ai'), aiStatus()]);
  return status.ready && (ai.features as Record<string, boolean>)[id] === true;
}
