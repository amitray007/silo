import type { AiLiveModel } from '@silo/core';
import type { AiModelsFetcher } from '@silo/core/ai-credential';
import { z } from 'zod';
import { aiErrorCode } from './errors.js';

const LIST_URL = 'https://api.fireworks.ai/v1/accounts/fireworks/models';
const MAX_PAGES = 10;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 500;
const MAX_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 256;
const LIST_TIMEOUT_MS = 10_000;

const deprecationDateSchema = z
  .union([
    z.iso.date(),
    z.iso.datetime({ offset: true }),
    z
      .object({
        year: z.number().int().min(1).max(9999),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
      })
      .transform(({ year, month, day }) =>
        [
          year.toString().padStart(4, '0'),
          month.toString().padStart(2, '0'),
          day.toString().padStart(2, '0'),
        ].join('-'),
      )
      .pipe(z.iso.date()),
  ])
  .transform((date) => Date.parse(date));

const modelSchema = z.object({
  name: z.string().min(1).max(MAX_ID_LENGTH),
  displayName: z.string().max(MAX_LABEL_LENGTH).nullable().optional(),
  contextLength: z.number().int().nonnegative().optional(),
  conversationConfig: z.object({}).nullable().optional(),
  supportsServerless: z.boolean().optional(),
  state: z.string().optional(),
  deprecationDate: deprecationDateSchema.nullable().optional(),
});
const pageSchema = z.object({
  models: z.array(z.unknown()).default([]),
  nextPageToken: z.string().optional(),
});

function usable(model: z.infer<typeof modelSchema>, now: number): boolean {
  const expires = model.deprecationDate;
  return (
    model.conversationConfig != null &&
    model.supportsServerless === true &&
    model.state === 'READY' &&
    (expires == null || expires >= now)
  );
}

/** One deadline covers paging and response bodies. Never reads or logs an error body. */
export function createFireworksModelsFetcher(fetch: typeof globalThis.fetch): AiModelsFetcher {
  return async (apiKey) => {
    try {
      if (!apiKey.trim()) return { ok: false, code: 'invalid_key' };
      const controller = new AbortController();
      const signal = AbortSignal.any([AbortSignal.timeout(LIST_TIMEOUT_MS), controller.signal]);
      const models = new Map<string, AiLiveModel>();
      let token = '';
      for (let page = 0; page < MAX_PAGES; page += 1) {
        signal.throwIfAborted();
        const data = await fetchPage(fetch, apiKey, token, signal, controller);
        addModels(models, data.models, controller);
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

function addModels(
  models: Map<string, AiLiveModel>,
  entries: unknown[],
  controller: AbortController,
): void {
  const now = Date.now();
  for (const entry of entries) {
    const parsed = modelSchema.safeParse(entry);
    if (!parsed.success || !usable(parsed.data, now)) continue;
    models.set(parsed.data.name, liveModel(parsed.data));
    if (models.size > MAX_MODELS) {
      const error = new Error('Model list exceeds model limit');
      controller.abort(error);
      throw error;
    }
  }
}

export const fireworksModelsFetcher: AiModelsFetcher = (key) =>
  createFireworksModelsFetcher(globalThis.fetch)(key);

async function fetchPage(
  fetch: typeof globalThis.fetch,
  apiKey: string,
  token: string,
  signal: AbortSignal,
  controller: AbortController,
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
  const data = pageSchema.parse(await readPage(response, controller));
  signal.throwIfAborted();
  return data;
}

async function readPage(response: Response, controller: AbortController): Promise<unknown> {
  if (!response.body) throw new Error('Missing model list body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) {
        const error = new Error('Model list body exceeds byte limit');
        controller.abort(error);
        void reader.cancel().catch(() => {});
        throw error;
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function liveModel(model: z.infer<typeof modelSchema>): AiLiveModel {
  return {
    id: model.name,
    label: (model.displayName || model.name.split('/').at(-1) || model.name).slice(
      0,
      MAX_LABEL_LENGTH,
    ),
    contextLength: model.contextLength || null,
  };
}
