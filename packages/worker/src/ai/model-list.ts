import type { AiLiveModel } from '@silo/core';
import type { AiModelsFetcher } from '@silo/core/ai-credential';
import { aiErrorCode } from './errors.js';

type ListPage = { entries: unknown[]; next?: string | undefined };
type ListConfig = {
  url: (token: string) => URL;
  headers: (key: string) => HeadersInit;
  page: (raw: unknown) => ListPage;
  model: (raw: unknown) => AiLiveModel | undefined;
  maxBytes?: number;
};

/** Fixed hosts, bounded pages, a single deadline, and no partial-list success. */
export function createModelListFetcher(
  fetch: typeof globalThis.fetch,
  config: ListConfig,
): AiModelsFetcher {
  return async (key) => {
    if (!key.trim()) return { ok: false, code: 'invalid_key' };
    const controller = new AbortController();
    const signal = AbortSignal.any([AbortSignal.timeout(20_000), controller.signal]);
    try {
      return { ok: true, models: await collectModels(fetch, config, key, controller, signal) };
    } catch (error) {
      controller.abort();
      return { ok: false, code: aiErrorCode(error) };
    }
  };
}

async function collectModels(
  fetch: typeof globalThis.fetch,
  config: ListConfig,
  key: string,
  controller: AbortController,
  signal: AbortSignal,
): Promise<AiLiveModel[]> {
  const models = new Map<string, AiLiveModel>();
  const tokens = new Set<string>();
  let token = '';
  for (let page = 0; page < 10; page += 1) {
    signal.throwIfAborted();
    const response = await fetch(config.url(token), {
      headers: config.headers(key),
      signal,
      redirect: 'error',
    });
    if (!response.ok)
      throw Object.assign(new Error('Model list failed'), { statusCode: response.status });
    const data = config.page(
      await readPage(response, controller, signal, config.maxBytes ?? 2 * 1024 * 1024),
    );
    addModels(models, data.entries, config.model);
    signal.throwIfAborted();
    token = data.next ?? '';
    if (!token) return [...models.values()];
    if (tokens.has(token)) throw new Error('Repeated page cursor');
    tokens.add(token);
  }
  throw new Error('Too many pages');
}

function addModels(
  models: Map<string, AiLiveModel>,
  entries: unknown[],
  normalize: ListConfig['model'],
): void {
  for (const entry of entries) {
    const model = normalize(entry);
    if (model) models.set(model.id, model);
    if (models.size > 500) throw new Error('Too many models');
  }
}

async function readPage(
  response: Response,
  controller: AbortController,
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  signal.throwIfAborted();
  if (!response.body) throw new Error('Missing model list body');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        const error = new Error('Model list exceeds byte limit');
        controller.abort(error);
        throw error;
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
