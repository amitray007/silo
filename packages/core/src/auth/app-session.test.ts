import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAppPassword, sessionSecret, verifyAppPassword } from './app-session.js';

const PASSWORD_VAR = 'SILO_APP_PASSWORD';
const SECRET_VAR = 'SILO_SESSION_SECRET';

beforeEach(() => {
  delete process.env[PASSWORD_VAR];
  delete process.env[SECRET_VAR];
});

afterEach(() => {
  delete process.env[PASSWORD_VAR];
  delete process.env[SECRET_VAR];
});

describe('readAppPassword', () => {
  it('returns the value when SILO_APP_PASSWORD is set', () => {
    process.env[PASSWORD_VAR] = 'hunter2';
    expect(readAppPassword()).toBe('hunter2');
  });

  it('returns undefined when unset', () => {
    expect(readAppPassword()).toBeUndefined();
  });
});

describe('verifyAppPassword', () => {
  it('returns false when no password is configured', () => {
    expect(verifyAppPassword('anything')).toBe(false);
  });

  it('returns true only on an exact match', () => {
    process.env[PASSWORD_VAR] = 'correct-horse-battery-staple';
    expect(verifyAppPassword('correct-horse-battery-staple')).toBe(true);
  });

  it('returns false for a wrong same-length candidate', () => {
    process.env[PASSWORD_VAR] = 'correct-horse-battery-staple';
    expect(verifyAppPassword('correct-horse-battery-staplX')).toBe(false);
  });

  it('is timing-safe: a length-mismatched candidate returns false, not a thrown error', () => {
    process.env[PASSWORD_VAR] = 'correct-horse-battery-staple';
    expect(verifyAppPassword('short')).toBe(false);
  });
});

describe('sessionSecret', () => {
  it('returns undefined when neither SILO_SESSION_SECRET nor SILO_APP_PASSWORD is set', () => {
    expect(sessionSecret()).toBeUndefined();
  });

  it('falls back to SILO_APP_PASSWORD when SILO_SESSION_SECRET is unset', () => {
    process.env[PASSWORD_VAR] = 'the-password';
    expect(sessionSecret()).toBe('the-password');
  });

  it('SILO_SESSION_SECRET wins when both are set', () => {
    process.env[PASSWORD_VAR] = 'the-password';
    process.env[SECRET_VAR] = 'a-dedicated-signing-secret';
    expect(sessionSecret()).toBe('a-dedicated-signing-secret');
  });

  it('uses SILO_SESSION_SECRET alone when SILO_APP_PASSWORD is unset', () => {
    process.env[SECRET_VAR] = 'a-dedicated-signing-secret';
    expect(sessionSecret()).toBe('a-dedicated-signing-secret');
  });
});
