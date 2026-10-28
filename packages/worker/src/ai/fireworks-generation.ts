import type { AiProviderKind } from '@silo/core';
import { APICallError, RetryError } from 'ai';

export const FIREWORKS_MAX_OUTPUT_TOKENS = 1024;

type GenerationSettings = {
  timeout: { totalMs: number };
  providerOptions?: { fireworks: { reasoningEffort: 'low' } };
};

/** Retry unsupported reasoning once, using only the time left from the first call. */
export async function withFireworksReasoning<T>(
  kind: AiProviderKind,
  timeoutMs: number,
  generate: (settings: GenerationSettings) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await generate({
      timeout: { totalMs: timeoutMs },
      ...(kind === 'fireworks'
        ? { providerOptions: { fireworks: { reasoningEffort: 'low' } } }
        : {}),
    });
  } catch (error) {
    const failure = RetryError.isInstance(error) ? error.lastError : error;
    if (
      kind !== 'fireworks' ||
      !APICallError.isInstance(failure) ||
      failure.statusCode !== 400 ||
      !/reasoning/i.test(failure.message)
    ) {
      throw error;
    }
    // Provider messages are inspected only for this fallback and never logged.
    const remainingMs = timeoutMs - (Date.now() - started);
    if (remainingMs <= 0) throw new DOMException('Generation timed out', 'TimeoutError');
    return generate({ timeout: { totalMs: remainingMs } });
  }
}
