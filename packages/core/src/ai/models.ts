import { aiProviders, db } from '@silo/db';
import { and, eq } from 'drizzle-orm';
import { AI_ERROR_CODES, type AiErrorCode } from './features.js';
import { modelsSchema } from './model-store.js';
import type { AiLiveModel, AiProviderKind } from './model-types.js';
import type { AiProviderSummary } from './providers.js';

export { storedProviderModels } from './model-store.js';

import { readAiProviderKey } from './providers.js';

export type AiModelsResult =
  | { ok: true; models: AiLiveModel[] }
  | { ok: false; code: AiErrorCode | 'unavailable' };

/** Protected port: only the worker receives the decrypted key. */
export type AiModelsFetcher = (apiKey: string) => Promise<AiModelsResult>;
export type AiProviderModelsFetcher = (
  kind: AiProviderKind,
  apiKey: string,
) => Promise<AiModelsResult>;
let fetcher: AiProviderModelsFetcher | undefined;
const inFlight = new Map<AiProviderKind, Promise<AiModelsResult>>();
export function setAiModelsFetcher(next: AiProviderModelsFetcher | undefined): void {
  fetcher = next;
}

/** Sanitizes provider output and uses ciphertext CAS so stale keys cannot overwrite a new list. */
export function refreshProviderModels(kind: AiProviderKind): Promise<AiModelsResult> {
  const pending = inFlight.get(kind);
  if (pending) return pending;
  const refresh = refreshModels(kind).finally(() => {
    inFlight.delete(kind);
  });
  inFlight.set(kind, refresh);
  return refresh;
}

/** GET callers receive their stored snapshot immediately; failures never reject into the process. */
export function refreshStaleProviderModels(providers: readonly AiProviderSummary[]): void {
  for (const provider of providers) {
    if (!provider.configured || !provider.keyReadable) continue;
    if (provider.modelsFetchedAt && Date.now() - provider.modelsFetchedAt.getTime() <= 86_400_000)
      continue;
    void refreshProviderModels(provider.kind).catch(() => {});
  }
}

async function refreshModels(kind: AiProviderKind): Promise<AiModelsResult> {
  if (!fetcher) return { ok: false, code: 'unavailable' };
  const key = await readAiProviderKey(kind);
  if (key.state !== 'ok') return { ok: false, code: 'unavailable' };
  let result: AiModelsResult;
  try {
    const raw = await fetcher(kind, key.apiKey);
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
    .where(and(eq(aiProviders.kind, kind), eq(aiProviders.encryptedKey, key.encryptedKey)))
    .returning({ kind: aiProviders.kind });
  return updated.length ? result : { ok: false, code: 'unavailable' };
}
