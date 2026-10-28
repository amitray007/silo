import { aiProviders, db } from '@silo/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../links/executor.js';
import type { AiLiveModel } from './catalog.js';

export const modelsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(512),
      label: z.string().min(1).max(256),
      contextLength: z.number().int().positive().nullable(),
    }),
  )
  .max(500);

export async function storedFireworksModels(executor: Executor = db): Promise<AiLiveModel[]> {
  const [row] = await executor
    .select({ models: aiProviders.models })
    .from(aiProviders)
    .where(eq(aiProviders.kind, 'fireworks'))
    .limit(1);
  return modelsSchema.safeParse(row?.models).data ?? [];
}
