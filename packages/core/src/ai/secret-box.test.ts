import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  needsReencrypt,
  SecretKeyMissingError,
  secretKeyStatus,
} from './secret-box.js';

const newKey = () => randomBytes(32).toString('base64');
const AAD = 'silo/ai-provider/anthropic';
const PLAINTEXT = 'sk-test-0000000000000000';

let saved: { key: string | undefined; previous: string | undefined };

beforeEach(() => {
  saved = {
    key: process.env.SILO_SECRET_KEY,
    previous: process.env.SILO_SECRET_KEY_PREVIOUS,
  };
  process.env.SILO_SECRET_KEY = newKey();
  delete process.env.SILO_SECRET_KEY_PREVIOUS;
});

afterEach(() => {
  for (const [name, value] of [
    ['SILO_SECRET_KEY', saved.key],
    ['SILO_SECRET_KEY_PREVIOUS', saved.previous],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('secret-box', () => {
  it('round-trips a secret and uses the documented blob format', () => {
    const blob = encryptSecret(PLAINTEXT, AAD);
    expect(blob.split('.')).toHaveLength(5);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain(PLAINTEXT);
    expect(decryptSecret(blob, AAD)).toBe(PLAINTEXT);
  });

  it('uses a fresh IV for each encryption', () => {
    expect(encryptSecret(PLAINTEXT, AAD)).not.toBe(encryptSecret(PLAINTEXT, AAD));
  });

  it('fails to decrypt under a different AAD', () => {
    const blob = encryptSecret(PLAINTEXT, AAD);
    expect(decryptSecret(blob, 'silo/ai-provider/openai')).toBeUndefined();
  });

  it('fails on a tampered tag or ciphertext', () => {
    const [v, kid, iv, tag, ct] = encryptSecret(PLAINTEXT, AAD).split('.') as [
      string,
      string,
      string,
      string,
      string,
    ];
    const flip = (part: string) => `${part.startsWith('A') ? 'B' : 'A'}${part.slice(1)}`;
    expect(decryptSecret([v, kid, iv, flip(tag), ct].join('.'), AAD)).toBeUndefined();
    expect(decryptSecret([v, kid, iv, tag, flip(ct)].join('.'), AAD)).toBeUndefined();
  });

  it('fails on an unknown kid', () => {
    const blob = encryptSecret(PLAINTEXT, AAD);
    process.env.SILO_SECRET_KEY = newKey();
    expect(decryptSecret(blob, AAD)).toBeUndefined();
  });

  it('returns undefined for malformed blobs instead of throwing', () => {
    for (const bad of ['', 'v1', 'v2.a.b.c.d', 'v1.a.b.c', 'v1.a.b.c.d.e', 'v1.aa.AA.AA.AA']) {
      expect(decryptSecret(bad, AAD)).toBeUndefined();
    }
  });

  it('decrypts with a previous key and flags the blob for re-encryption', () => {
    const oldKey = process.env.SILO_SECRET_KEY as string;
    const blob = encryptSecret(PLAINTEXT, AAD);
    expect(needsReencrypt(blob)).toBe(false);

    process.env.SILO_SECRET_KEY = newKey();
    expect(decryptSecret(blob, AAD)).toBeUndefined();
    process.env.SILO_SECRET_KEY_PREVIOUS = `${newKey()}, ${oldKey}`;
    expect(decryptSecret(blob, AAD)).toBe(PLAINTEXT);
    expect(needsReencrypt(blob)).toBe(true);
    expect(needsReencrypt(encryptSecret(PLAINTEXT, AAD))).toBe(false);
  });

  it('needsReencrypt is false for malformed blobs and when no current key exists', () => {
    const blob = encryptSecret(PLAINTEXT, AAD);
    expect(needsReencrypt('garbage')).toBe(false);
    delete process.env.SILO_SECRET_KEY;
    expect(needsReencrypt(blob)).toBe(false);
  });

  it('reports key status and throws a typed error when encrypting without a valid key', () => {
    expect(secretKeyStatus()).toBe('ok');

    delete process.env.SILO_SECRET_KEY;
    expect(secretKeyStatus()).toBe('missing');
    expect(() => encryptSecret(PLAINTEXT, AAD)).toThrow(SecretKeyMissingError);

    process.env.SILO_SECRET_KEY = '';
    expect(secretKeyStatus()).toBe('missing');

    for (const bad of ['not base64!', randomBytes(16).toString('base64'), 'AAAA']) {
      process.env.SILO_SECRET_KEY = bad;
      expect(secretKeyStatus()).toBe('invalid');
      expect(() => encryptSecret(PLAINTEXT, AAD)).toThrow(SecretKeyMissingError);
    }
  });

  it('the missing-key error message carries no key material', () => {
    process.env.SILO_SECRET_KEY = 'short-secret-value';
    try {
      encryptSecret(PLAINTEXT, AAD);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('short-secret-value');
      expect(String(error)).not.toContain(PLAINTEXT);
    }
  });
});
