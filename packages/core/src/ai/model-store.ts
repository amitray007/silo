import { aiProviders, db } from '@silo/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../links/executor.js';
import { type AiLiveModel, type AiProviderKind, liveModelSchema } from './model-types.js';

export const modelsSchema = z.array(liveModelSchema).max(500);
const legacyFireworks = z
  .object({
    id: z.string().min(1).max(512),
    label: z.string().min(1).max(256),
    contextLength: z.number().int().positive().nullable(),
  })
  .transform(
    ({ id, label, contextLength }): AiLiveModel => ({
      id,
      label,
      ...(contextLength ? { contextWindow: contextLength } : {}),
      structuredOutput: 'native',
      reasoning: { type: 'fireworks' },
    }),
  );

/** Upgrade existing Fireworks JSON without changing SQL columns or losing its cached list. */
export function parseStoredModels(kind: AiProviderKind, raw: unknown): AiLiveModel[] {
  const schema =
    kind === 'fireworks'
      ? z.array(z.union([liveModelSchema, legacyFireworks])).max(500)
      : modelsSchema;
  return schema.safeParse(raw).data ?? [];
}

export async function storedProviderModels(
  kind: AiProviderKind,
  executor: Executor = db,
): Promise<AiLiveModel[]> {
  return (await storedProviderList(kind, executor)).models;
}

export async function storedProviderList(
  kind: AiProviderKind,
  executor: Executor = db,
): Promise<{ models: AiLiveModel[]; fetchedAt: Date | null }> {
  const [row] = await executor
    .select({ models: aiProviders.models, fetchedAt: aiProviders.modelsFetchedAt })
    .from(aiProviders)
    .where(eq(aiProviders.kind, kind))
    .limit(1);
  return { models: parseStoredModels(kind, row?.models), fetchedAt: row?.fetchedAt ?? null };
}
