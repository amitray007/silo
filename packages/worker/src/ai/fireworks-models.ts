import type { AiLiveModel } from '@silo/core';
import type { AiModelsFetcher } from '@silo/core/ai-credential';
import { z } from 'zod';
import { aiErrorCode } from './errors.js';

const LIST_URL = 'https://api.fireworks.ai/v1/accounts/fireworks/models';
const MAX_PAGES = 10;
const LIST_TIMEOUT_MS = 10_000;

const modelSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().nullable().optional(),
  contextLength: z.number().int().nonnegative().optional(),
  conversationConfig: z.object({}).nullable().optional(),
  supportsServerless: z.boolean().optional(),
  state: z.string().optional(),
  deprecationDate: z.string().nullable().optional(),
});
const pageSchema = z.object({
  models: z.array(modelSchema).default([]),
  nextPageToken: z.string().optional(),
});

function usable(model: z.infer<typeof modelSchema>, now: number): boolean {
  const expires = model.deprecationDate;
  return (
    model.conversationConfig != null &&
    model.supportsServerless === true &&
    model.state === 'READY' &&
    (!expires || Date.parse(expires) >= now)
  );
}

/** One deadline covers paging and response bodies. Never reads or logs an error body. */
export function createFireworksModelsFetcher(fetch: typeof globalThis.fetch): AiModelsFetcher {
  return async (apiKey) => {
    try {
      if (!apiKey.trim()) return { ok: false, code: 'invalid_key' };
      const signal = AbortSignal.timeout(LIST_TIMEOUT_MS);
      const models = new Map<string, AiLiveModel>();
      let token = '';
      for (let page = 0; page < MAX_PAGES; page += 1) {
        signal.throwIfAborted();
        const data = await fetchPage(fetch, apiKey, token, signal);
        const now = Date.now();
        for (const model of data.models.filter((entry) => usable(entry, now))) {
          models.set(model.name, liveModel(model));
        }
        token = data.nextPageToken ?? '';
        if (!token) return { ok: true, models: [...models.values()] };
      }
      // Do not replace the stored list with a truncated result.
      return { ok: false, code: 'provider_error' };
    } catch (error) {
      return { ok: false, code: aiErrorCode(error) };
    }
  };
}

export const fireworksModelsFetcher: AiModelsFetcher = (key) =>
  createFireworksModelsFetcher(globalThis.fetch)(key);

async function fetchPage(
  fetch: typeof globalThis.fetch,
  apiKey: string,
  token: string,
  signal: AbortSignal,
): Promise<z.infer<typeof pageSchema>> {
  const url = new URL(LIST_URL);
  url.searchParams.set('pageSize', '200');
  if (token) url.searchParams.set('pageToken', token);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
    redirect: 'error',
  });
  if (!response.ok)
    throw Object.assign(new Error('Model list request failed'), { statusCode: response.status });
  const data = pageSchema.parse(await response.json());
  signal.throwIfAborted();
  return data;
}

function liveModel(model: z.infer<typeof modelSchema>): AiLiveModel {
  return {
    id: model.name,
    label: model.displayName || model.name.split('/').at(-1) || model.name,
    contextLength: model.contextLength || null,
  };
}
