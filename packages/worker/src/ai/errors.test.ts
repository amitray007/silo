import { generateText, RetryError } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { aiErrorCode, logAiFailure } from './errors.js';
import { languageModelFor } from './model.js';
import { apiError, credential, LEAK_KEY } from './test-helpers.js';

describe('aiErrorCode', () => {
  it.each([
    [401, 'invalid_key'],
    [402, 'quota'],
    [412, 'no_access'],
    [403, 'no_access'],
    [404, 'model_not_found'],
    [429, 'rate_limited'],
    [400, 'provider_error'],
    [500, 'provider_error'],
    [503, 'provider_error'],
  ] as const)('maps status %s to %s', (status, code) => {
    expect(aiErrorCode(apiError(status))).toBe(code);
  });

  it('unwraps a RetryError to its last error', () => {
    const error = new RetryError({
      message: `failed ${LEAK_KEY}`,
      reason: 'maxRetriesExceeded',
      errors: [apiError(429), apiError(429)],
    });
    expect(aiErrorCode(error)).toBe('rate_limited');
  });

  it('maps timeout and abort errors to timeout', () => {
    expect(aiErrorCode(new DOMException('x', 'TimeoutError'))).toBe('timeout');
    expect(aiErrorCode(new DOMException('x', 'AbortError'))).toBe('timeout');
  });

  it('maps network failures to network', () => {
    const fetchFailed = new TypeError('fetch failed');
    expect(aiErrorCode(fetchFailed)).toBe('network');
    const reset = new TypeError('other', {
      cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }),
    });
    expect(aiErrorCode(reset)).toBe('network');
    expect(aiErrorCode(apiError(undefined))).toBe('provider_error');
    const wrapped = Object.assign(apiError(undefined), { cause: { code: 'ENOTFOUND' } });
    expect(aiErrorCode(wrapped)).toBe('network');
  });

  it('maps anything else to provider_error', () => {
    expect(aiErrorCode(new Error(`boom ${LEAK_KEY}`))).toBe('provider_error');
    expect(aiErrorCode('string')).toBe('provider_error');
    expect(aiErrorCode(undefined)).toBe('provider_error');
  });
});

describe('aiErrorCode with gateway errors', () => {
  // @ai-sdk/gateway is not a direct dependency, so these are same-shaped objects.
  const named = (name: string, statusCode?: number, cause?: unknown) =>
    Object.assign(new Error(`secret ${LEAK_KEY}`, { cause }), {
      name,
      ...(statusCode === undefined ? {} : { statusCode }),
    });

  it('maps by status code on a gateway-shaped error', () => {
    expect(aiErrorCode(named('GatewayAuthenticationError', 401))).toBe('invalid_key');
    expect(aiErrorCode(named('GatewayRateLimitError', 429))).toBe('rate_limited');
  });

  it('maps by name when there is no status code, also when wrapped', () => {
    expect(aiErrorCode(named('GatewayAuthenticationError'))).toBe('invalid_key');
    expect(aiErrorCode(named('GatewayForbiddenError'))).toBe('no_access');
    expect(aiErrorCode(named('GatewayModelNotFoundError'))).toBe('model_not_found');
    expect(aiErrorCode(named('GatewayRateLimitError'))).toBe('rate_limited');
    expect(aiErrorCode(named('GatewayTimeoutError'))).toBe('timeout');
    const wrapped = new Error('wrapper', { cause: named('GatewayAuthenticationError') });
    expect(aiErrorCode(wrapped)).toBe('invalid_key');
    const retry = new RetryError({
      message: 'x',
      reason: 'maxRetriesExceeded',
      errors: [wrapped],
    });
    expect(aiErrorCode(retry)).toBe('invalid_key');
  });

  it.each([
    [401, 'invalid_key'],
    [402, 'quota'],
    [412, 'no_access'],
    [429, 'rate_limited'],
  ] as const)('maps a real createGateway %s response', async (status, code) => {
    const fetch = (async () =>
      new Response(JSON.stringify({ error: { message: `bad ${LEAK_KEY}`, type: 'x' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch;
    const model = languageModelFor({ ...credential, kind: 'gateway' }, fetch);
    const failure = await generateText({ model, prompt: 'hi', maxRetries: 0 }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(aiErrorCode(failure)).toBe(code);
  });
});

describe('logAiFailure', () => {
  it('logs exactly one fixed line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logAiFailure('x_title', 3, 'timeout');
    expect(warn.mock.calls).toEqual([['silo ai: x_title@v3 failed (timeout)']]);
    warn.mockRestore();
  });
});
