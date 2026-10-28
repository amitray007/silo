import type { AiLiveModel } from '@silo/core';
import type { AiModelsFetcher } from '@silo/core/ai-credential';
import { z } from 'zod';
import { createModelListFetcher } from './model-list.js';

// Intentionally a family rule, not a list of releases. Unknown suffixes fail closed.
const GENERAL_MODEL =
  /^(?:gpt-\d+(?:\.\d+)?o?(?:-(?:mini|nano|luna|terra|sol|astra))?|o\d+(?:-mini)?)(?:-\d{4}-\d{2}-\d{2})?$/;
const EXCLUDED =
  /audio|realtime|transcribe|tts|image|search|codex|embedding|moderation|pro|preview|ft:/i;
export function isOpenAiTitleModel(id: string): boolean {
  return GENERAL_MODEL.test(id) && !EXCLUDED.test(id);
}

/** Small table of known differences; new reasoning families start conservatively at low. */
export function openAiReasoning(id: string): AiLiveModel['reasoning'] {
  const family = id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const rules: [RegExp, 'none' | 'minimal' | 'low' | undefined][] = [
    [/^gpt-[1-4](?:[.o-]|$)/, undefined],
    [/^gpt-5(?:-(?:mini|nano))?$/, 'minimal'],
    [/^gpt-\d+(?:\.\d+)?-(?:astra|sol)$/, 'low'],
    [/^gpt-\d+(?:\.\d+)?-(?:luna|terra|mini|nano)$/, 'none'],
    [/^gpt-5\.[1-9]\d*$/, 'none'],
    [/^(?:gpt-[5-9]|gpt-\d{2,}|o\d)/, 'low'],
  ];
  const effort = rules.find(([pattern]) => pattern.test(family))?.[1];
  return { type: 'openai', ...(effort ? { effort } : {}) };
}
const modelSchema = z.object({
  id: z.string().min(1).max(512),
  created: z.number().int().nonnegative().optional(),
  owned_by: z.string().min(1).max(128).optional(),
  shutdown_date: z.string().nullish(),
});
const pageSchema = z.object({ data: z.array(z.unknown()) });

export function createOpenAiModelsFetcher(fetch: typeof globalThis.fetch): AiModelsFetcher {
  return createModelListFetcher(fetch, {
    url: () => new URL('https://api.openai.com/v1/models'),
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    page: (raw) => ({ entries: pageSchema.parse(raw).data }),
    model: (raw) => {
      const parsed = modelSchema.safeParse(raw);
      if (!parsed.success) return undefined;
      const m = parsed.data;
      if (
        !isOpenAiTitleModel(m.id) ||
        (m.shutdown_date && Date.parse(m.shutdown_date) < Date.now())
      )
        return undefined;
      return {
        id: m.id,
        label: m.id.slice(0, 256),
        ...(m.owned_by ? { owner: m.owned_by } : {}),
        ...(m.created ? { createdAt: new Date(m.created * 1000).toISOString() } : {}),
        structuredOutput: 'unknown',
        reasoning: openAiReasoning(m.id),
      };
    },
  });
}
