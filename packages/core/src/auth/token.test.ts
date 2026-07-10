import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTokenEnv, timingSafeEqual } from './token.js';

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('returns false for unequal same-length strings', () => {
    expect(timingSafeEqual('secret-token', 'secret-tokeX')).toBe(false);
  });

  it('returns false for different-length strings', () => {
    expect(timingSafeEqual('short', 'a-much-longer-string')).toBe(false);
  });

  it('returns true for empty vs empty', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('readTokenEnv', () => {
  const ENV_VAR = 'SILO_TEST_TOKEN_ENV';

  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('returns the value when the env var is set', () => {
    process.env[ENV_VAR] = 'my-token';
    expect(readTokenEnv(ENV_VAR)).toBe('my-token');
  });

  it('returns undefined when the env var is unset', () => {
    expect(readTokenEnv(ENV_VAR)).toBeUndefined();
  });

  it('returns undefined when the env var is an empty string', () => {
    process.env[ENV_VAR] = '';
    expect(readTokenEnv(ENV_VAR)).toBeUndefined();
  });
});
