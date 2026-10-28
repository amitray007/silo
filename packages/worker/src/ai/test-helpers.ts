import type { CatalogEntry } from '@silo/core';
import type { AiCredential } from '@silo/core/ai-credential';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { vi } from 'vitest';

/** Node's native AbortSignal.timeout does not follow Vitest's fake clock. */
export function fakeAbortTimeout(): void {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
}

/** Holds a read open until a cancellation test releases it. */
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const LEAK_KEY = 'sk-test-LEAK-0000';

export const credential: AiCredential & { model: CatalogEntry } = {
  kind: 'anthropic',
  apiKey: LEAK_KEY,
  model: {
    id: 'claude-haiku-5-5',
    family: 'claude',
    label: 'Claude Haiku 5.5',
    tier: 'fast',
    anthropicId: 'claude-haiku-5-5',
    gatewayId: 'anthropic/claude-haiku-5.5',
    reasoning: 'none',
  },
};

export function okResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

/** An error that carries the key in every field a leak could come from. */
export function apiError(
  statusCode: number | undefined,
  message = `bad key ${LEAK_KEY}`,
): APICallError {
  return new APICallError({
    message,
    url: `https://api.example.com/v1?key=${LEAK_KEY}`,
    requestBodyValues: { prompt: 'SECRET PROMPT TEXT', key: LEAK_KEY },
    ...(statusCode === undefined ? {} : { statusCode }),
    responseBody: `{"error":"invalid ${LEAK_KEY}"}`,
    isRetryable: statusCode === 429 || (statusCode !== undefined && statusCode >= 500),
  });
}

export function failingModel(error: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}
