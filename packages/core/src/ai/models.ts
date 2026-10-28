import { aiProviders, db } from '@silo/db';
import { and, eq } from 'drizzle-orm';
import type { AiLiveModel } from './catalog.js';
import { AI_ERROR_CODES, type AiErrorCode } from './features.js';
import { modelsSchema } from './model-store.js';

export { storedFireworksModels } from './model-store.js';

import { readAiProviderKey } from './providers.js';

export type AiModelsResult =
  | { ok: true; models: AiLiveModel[] }
  | { ok: false; code: AiErrorCode | 'unavailable' };

/** Protected port: only the worker receives the decrypted key. */
export type AiModelsFetcher = (apiKey: string) => Promise<AiModelsResult>;
let fetcher: AiModelsFetcher | undefined;
export function setAiModelsFetcher(next: AiModelsFetcher | undefined): void {
  fetcher = next;
}

/** Sanitizes provider output and uses ciphertext CAS so stale keys cannot overwrite a new list. */
export async function refreshFireworksModels(): Promise<AiModelsResult> {
  if (!fetcher) return { ok: false, code: 'unavailable' };
  const key = await readAiProviderKey('fireworks');
  if (key.state !== 'ok') return { ok: false, code: 'unavailable' };
  let result: AiModelsResult;
  try {
    const raw = await fetcher(key.apiKey);
    result = raw.ok
      ? { ok: true, models: modelsSchema.parse(raw.models) }
      : { ok: false, code: AI_ERROR_CODES.find((code) => code === raw.code) ?? 'provider_error' };
  } catch {
    result = { ok: false, code: 'provider_error' };
  }
  const updated = await db
    .update(aiProviders)
    .set(
      result.ok
        ? { models: result.models, modelsFetchedAt: new Date(), modelsRefreshError: null }
        : { modelsRefreshError: result.code },
    )
    .where(and(eq(aiProviders.kind, 'fireworks'), eq(aiProviders.encryptedKey, key.encryptedKey)))
    .returning({ kind: aiProviders.kind });
  return updated.length ? result : { ok: false, code: 'unavailable' };
}
