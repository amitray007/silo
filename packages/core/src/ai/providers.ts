import { aiProviders, db } from '@silo/db';
import { and, eq } from 'drizzle-orm';
import { getSetting, setSetting } from '../settings/settings.js';
import { AI_PROVIDER_KINDS, type AiLiveModel, type AiProviderKind } from './catalog.js';
import { AI_ERROR_CODES, type AiErrorCode } from './features.js';
import { decryptSecret, encryptSecret, needsReencrypt, secretKeyStatus } from './secret-box.js';

/**
 * Provider key storage (AI foundation). The only module that writes
 * `ai_providers`. The plaintext key exists here only inside `saveAiProviderKey`
 * (until it is encrypted) and, via `readAiProviderKey`, for one AI call.
 * Nothing returned to an adapter carries the key or its ciphertext.
 */

/** Thrown when an API key is not 8-300 printable ASCII characters. Never carries the key. */
export class InvalidAiApiKeyError extends Error {
  constructor() {
    super('API key must be 8-300 printable ASCII characters');
    this.name = 'InvalidAiApiKeyError';
  }
}

export type AiProviderSummary = {
  kind: AiProviderKind;
  models?: AiLiveModel[];
  modelsFetchedAt?: Date | null;
  modelsRefreshError?: AiErrorCode | null;
  configured: boolean;
  keyLast4: string | null;
  /** False only when a row exists but no configured secret key decrypts it. */
  keyReadable: boolean;
  lastTest: { ok: boolean; at: Date; code: string | null } | null;
};

const API_KEY_SHAPE = /^[\x21-\x7e]{8,300}$/;

/** The AAD that binds a ciphertext to its provider row. */
function aadFor(kind: AiProviderKind): string {
  return `silo/ai-provider/${kind}`;
}

/**
 * All provider kinds, configured or not. Never returns key material:
 * `keyReadable` comes from a trial decrypt whose plaintext is discarded.
 */
export async function listAiProviders(): Promise<AiProviderSummary[]> {
  const rows = await db
    .select({
      kind: aiProviders.kind,
      encryptedKey: aiProviders.encryptedKey,
      keyLast4: aiProviders.keyLast4,
      lastTestOk: aiProviders.lastTestOk,
      lastTestAt: aiProviders.lastTestAt,
      lastTestCode: aiProviders.lastTestCode,
      models: aiProviders.models,
      modelsFetchedAt: aiProviders.modelsFetchedAt,
      modelsRefreshError: aiProviders.modelsRefreshError,
    })
    .from(aiProviders);
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  return AI_PROVIDER_KINDS.map((kind) => {
    const row = byKind.get(kind);
    const live =
      kind === 'fireworks'
        ? {
            models: row?.models ?? [],
            modelsFetchedAt: row?.modelsFetchedAt ?? null,
            modelsRefreshError:
              AI_ERROR_CODES.find((code) => code === row?.modelsRefreshError) ?? null,
          }
        : {};
    if (!row)
      return {
        kind,
        ...live,
        configured: false,
        keyLast4: null,
        keyReadable: true,
        lastTest: null,
      };
    const tested = row.lastTestOk !== null && row.lastTestAt !== null;
    return {
      kind,
      ...live,
      configured: true,
      keyLast4: row.keyLast4,
      keyReadable: decryptSecret(row.encryptedKey, aadFor(kind)) !== undefined,
      lastTest: tested
        ? { ok: row.lastTestOk === true, at: row.lastTestAt as Date, code: row.lastTestCode }
        : null,
    };
  });
}

/**
 * Stores (or replaces) the key for `kind`: trims it, validates it, encrypts it
 * with the row-bound AAD, keeps the last 4 characters for display, and clears
 * the previous test result. Throws `InvalidAiApiKeyError` or `SecretKeyMissingError`.
 */
export async function saveAiProviderKey(kind: AiProviderKind, apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!API_KEY_SHAPE.test(key)) throw new InvalidAiApiKeyError();
  const encryptedKey = encryptSecret(key, aadFor(kind));
  const values = {
    encryptedKey,
    keyLast4: key.slice(-4),
    lastTestOk: null,
    lastTestAt: null,
    lastTestCode: null,
    models: null,
    modelsFetchedAt: null,
    modelsRefreshError: null,
  };
  await db
    .insert(aiProviders)
    .values({ kind, ...values })
    .onConflictDoUpdate({ target: aiProviders.kind, set: values });
}

/**
 * Deletes the key and clears selections for that provider in one transaction.
 */
export async function removeAiProvider(kind: AiProviderKind): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(aiProviders).where(eq(aiProviders.kind, kind));
    const ai = await getSetting('ai', tx);
    for (const feature of Object.values(ai.features)) {
      if (feature.model?.provider === kind) feature.model = null;
    }
    await setSetting('ai', ai, tx);
  });
}

/**
 * Records the outcome of a connection test. A missing row is a no-op. With
 * `expectedEncryptedKey` it records only while the row still holds that
 * ciphertext, so a result for a replaced key is dropped instead of attached to
 * the new one.
 */
export async function recordAiTest(
  kind: AiProviderKind,
  result: { ok: boolean; code?: AiErrorCode },
  expectedEncryptedKey?: string,
): Promise<void> {
  const match =
    expectedEncryptedKey === undefined
      ? eq(aiProviders.kind, kind)
      : and(eq(aiProviders.kind, kind), eq(aiProviders.encryptedKey, expectedEncryptedKey));
  await db
    .update(aiProviders)
    .set({ lastTestOk: result.ok, lastTestAt: new Date(), lastTestCode: result.code ?? null })
    .where(match);
}

export type AiKeyRead =
  | { state: 'ok'; apiKey: string; encryptedKey: string }
  | { state: 'no_key' }
  | { state: 'key_unreadable' };

/**
 * Decrypts the stored key for `kind`. INTERNAL to the AI layer: `status.ts` is
 * the only caller, and it never hands the result (key or ciphertext) to an adapter.
 */
export async function readAiProviderKey(kind: AiProviderKind): Promise<AiKeyRead> {
  const [row] = await db
    .select({ encryptedKey: aiProviders.encryptedKey })
    .from(aiProviders)
    .where(eq(aiProviders.kind, kind))
    .limit(1);
  if (!row) return { state: 'no_key' };
  const apiKey = decryptSecret(row.encryptedKey, aadFor(kind));
  return apiKey === undefined
    ? { state: 'key_unreadable' }
    : { state: 'ok', apiKey, encryptedKey: row.encryptedKey };
}

/**
 * Moves every row whose key id is not the current one onto the current key, in
 * one transaction (key rotation). A row no configured key can decrypt is left
 * untouched and counted as unreadable. Does nothing without a valid current key.
 *
 * Each update is compare-and-swap on the ciphertext that was read, so a key
 * saved meanwhile is never overwritten by the old one (and is not counted).
 * `afterRead` is a test seam that runs between the read and the updates.
 */
export async function reencryptAiProviders(
  options: { afterRead?: () => Promise<void> } = {},
): Promise<{ reencrypted: number; unreadable: number }> {
  if (secretKeyStatus() !== 'ok') return { reencrypted: 0, unreadable: 0 };
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ kind: aiProviders.kind, encryptedKey: aiProviders.encryptedKey })
      .from(aiProviders);
    await options.afterRead?.();
    let reencrypted = 0;
    let unreadable = 0;
    for (const row of rows) {
      if (!needsReencrypt(row.encryptedKey)) continue;
      const apiKey = decryptSecret(row.encryptedKey, aadFor(row.kind));
      if (apiKey === undefined) {
        unreadable += 1;
        continue;
      }
      const updated = await tx
        .update(aiProviders)
        .set({ encryptedKey: encryptSecret(apiKey, aadFor(row.kind)) })
        .where(and(eq(aiProviders.kind, row.kind), eq(aiProviders.encryptedKey, row.encryptedKey)))
        .returning({ kind: aiProviders.kind });
      reencrypted += updated.length;
    }
    return { reencrypted, unreadable };
  });
}
