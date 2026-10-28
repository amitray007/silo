import { z } from 'zod';
import type { AiFeatureDefinition } from '../../ai/define.js';
import { buildPrompt, instructions, promptVersion, type XPostTitleInput } from './prompt.js';
import { postProcess } from './sanitize.js';

/** AI titles for saved X posts (`docs/methods/ai-x-titles.md`). */
export const xPostTitle: AiFeatureDefinition<XPostTitleInput, string, { title: string }> = {
  id: 'x-post-title',
  promptVersion,
  instructions,
  buildPrompt,
  schema: z.object({ title: z.string() }),
  postProcess: (output) => postProcess(output.title) ?? undefined,
  timeoutMs: 15_000,
};
