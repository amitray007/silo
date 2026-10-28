import type { AiErrorCode } from '@silo/core';
import { RetryError } from 'ai';

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const NAME_CODES: Record<string, AiErrorCode> = {
  GatewayAuthenticationError: 'invalid_key',
  GatewayForbiddenError: 'no_access',
  GatewayModelNotFoundError: 'model_not_found',
  GatewayRateLimitError: 'rate_limited',
  GatewayTimeoutError: 'timeout',
  TimeoutError: 'timeout',
  AbortError: 'timeout',
};

function statusCode(status: number): AiErrorCode {
  if (status === 401) return 'invalid_key';
  if (status === 403) return 'no_access';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limited';
  return 'provider_error';
}

/** Walks the error and its causes a few levels, reading only `statusCode`, `name` and `code`. */
function* chain(
  error: unknown,
): Generator<{ statusCode?: unknown; name?: unknown; code?: unknown }> {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    yield current;
    current = (current as { cause?: unknown }).cause;
  }
}

/**
 * Maps any thrown value to a fixed code. It reads only a status code, an error
 * name and an error code, on the error and its causes: never `message`,
 * `responseBody`, `requestBodyValues` or `url`, which can hold the key or the
 * prompt. Order: status code, known names, network codes, else provider_error.
 */
export function aiErrorCode(error: unknown): AiErrorCode {
  const root = RetryError.isInstance(error) ? error.lastError : error;
  const links = [...chain(root)];
  const status = links.find((link) => typeof link.statusCode === 'number')?.statusCode;
  if (typeof status === 'number') return statusCode(status);
  for (const link of links) {
    const byName = typeof link.name === 'string' ? NAME_CODES[link.name] : undefined;
    if (byName) return byName;
  }
  const network = links.some(
    (link) =>
      (typeof link.code === 'string' && NETWORK_CODES.has(link.code)) ||
      (link instanceof TypeError && link.message === 'fetch failed'),
  );
  return network ? 'network' : 'provider_error';
}

/** One line, fixed fields only. Never the prompt, the output, the key or the provider's message. */
export function logAiFailure(
  feature: string,
  version: number,
  code: AiErrorCode | 'invalid_output',
): void {
  console.warn(`silo ai: ${feature}@v${version} failed (${code})`);
}
