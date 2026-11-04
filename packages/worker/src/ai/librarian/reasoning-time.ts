import type { TextStreamPart, ToolSet } from 'ai';

type Part = TextStreamPart<ToolSet>;

const isReasoning = (part: Part) => part.type.startsWith('reasoning-');
// Bookkeeping parts say nothing about what the model is doing.
const isBookkeeping = (part: Part) => part.type === 'start-step' || part.type === 'raw';

/**
 * Total reasoning time of one run, for `messageMetadata`: each step counts from its first
 * reasoning delta to its first non-reasoning part. Returns metadata only when the total grows.
 */
export function reasoningTimer(now: () => number = Date.now) {
  let startedAt: number | undefined;
  let totalMs = 0;
  return ({ part }: { part: Part }): { reasoningMs: number } | undefined => {
    if (part.type === 'reasoning-delta') {
      startedAt ??= now();
      return undefined;
    }
    if (startedAt === undefined || isReasoning(part) || isBookkeeping(part)) return undefined;
    totalMs += now() - startedAt;
    startedAt = undefined;
    return { reasoningMs: totalMs };
  };
}
