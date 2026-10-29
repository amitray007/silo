import type { AiLiveModel } from '@silo/core';
import type { AiModelsFetcher } from '@silo/core/ai-credential';
import { z } from 'zod';
import { createModelListFetcher } from './model-list.js';

const LIST_URL = 'https://api.fireworks.ai/v1/accounts/fireworks/models';
const MAX_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 256;

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
  kind: z.string().optional(),
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
    // `kind` is documented at https://docs.fireworks.ai/api-reference/list-models.
    // Both Qwen embedding and reranker models report EMBEDDING_MODEL in the live API.
    model.kind !== 'EMBEDDING_MODEL' &&
    !/embedding|rerank/i.test(model.name) &&
    model.conversationConfig != null &&
    model.supportsServerless === true &&
    model.state === 'READY' &&
    (expires == null || expires >= now)
  );
}

/** Fireworks' list endpoint only returns serverless models with this filter. */
export function createFireworksModelsFetcher(fetch: typeof globalThis.fetch): AiModelsFetcher {
  return createModelListFetcher(fetch, {
    url: (token) => {
      const url = new URL(LIST_URL);
      url.searchParams.set('pageSize', '200');
      url.searchParams.set('filter', 'supports_serverless=true');
      if (token) url.searchParams.set('pageToken', token);
      return url;
    },
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    page: (raw) => {
      const data = pageSchema.parse(raw);
      return { entries: data.models, next: data.nextPageToken };
    },
    model: (raw) => {
      const parsed = modelSchema.safeParse(raw);
      return parsed.success && usable(parsed.data, Date.now()) ? liveModel(parsed.data) : undefined;
    },
  });
}

export const fireworksModelsFetcher: AiModelsFetcher = (key) =>
  createFireworksModelsFetcher(globalThis.fetch)(key);

function liveModel(model: z.infer<typeof modelSchema>): AiLiveModel {
  return {
    id: model.name,
    label: (model.displayName || model.name.split('/').at(-1) || model.name).slice(
      0,
      MAX_LABEL_LENGTH,
    ),
    ...(model.contextLength ? { contextWindow: model.contextLength } : {}),
    structuredOutput: 'native',
    reasoning: { type: 'fireworks' },
  };
}
