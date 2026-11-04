import type { TextStreamPart, ToolSet } from 'ai';

type Part = TextStreamPart<ToolSet>;

const isReasoning = (part: Part) => part.type.startsWith('reasoning-');
// Bookkeeping parts say nothing about what the model is doing.
const isBookkeeping = (part: Part) => part.type === 'start-step' || part.type === 'raw';

/**
 * Total reasoning time of one run, for `messageMetadata`: each step counts from its first
 * reasoning delta to its first non-reasoning part. Returns metadata only when the total grows.
 */
export function reasoningTimer(now: () => number = Date.now, initialMs = 0) {
  let startedAt: number | undefined;
  let totalMs = initialMs;
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

/** Record raw provider timing before any transform can add presentation delays. */
export function reasoningTiming(initialMs = 0, now: () => number = Date.now) {
  const timer = reasoningTimer(now, initialMs);
  const metadata = new WeakMap<Part, { reasoningMs: number }>();
  return {
    transform: () =>
      new TransformStream<Part, Part>(
        {
          transform(part, controller) {
            const value = timer({ part });
            if (value) metadata.set(part, value);
            controller.enqueue(part);
          },
        },
        undefined,
        { highWaterMark: Number.POSITIVE_INFINITY },
      ),
    messageMetadata: ({ part }: { part: Part }) => metadata.get(part),
  };
}
