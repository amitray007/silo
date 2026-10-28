import type { AiFeatureId } from '@silo/core';
import type { z } from 'zod';

/** A feature's behavior: prompt, schema and post-processing. The runner owns provider, retries and logging. */
export type AiFeatureDefinition<In = never, Out = unknown, Raw = unknown> = {
  id: AiFeatureId;
  /** Bump when the prompt or schema changes; it appears in failure logs. */
  promptVersion: number;
  instructions: string;
  buildPrompt(input: In): string;
  schema: z.ZodType<Raw>;
  /** Returns `undefined` to reject the model's output. */
  postProcess(output: Raw): Out | undefined;
  timeoutMs: number;
};
