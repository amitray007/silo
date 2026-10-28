import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAiAtStartup } from './startup.js';

afterEach(() => vi.restoreAllMocks());

const run = (
  reencrypt: () => Promise<{ reencrypted: number; unreadable: number }>,
  status = 'ok',
) =>
  prepareAiAtStartup({
    reencrypt,
    keyStatus: () => status as 'ok' | 'missing' | 'invalid',
  });

describe('prepareAiAtStartup', () => {
  it('logs counts only, and only when non-zero', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await run(async () => ({ reencrypted: 0, unreadable: 0 }));
    expect(warn).not.toHaveBeenCalled();
    await run(async () => ({ reencrypted: 2, unreadable: 1 }));
    expect(warn.mock.calls).toEqual([['silo ai: re-encrypted 2 provider key(s), 1 unreadable']]);
  });

  it('names SILO_SECRET_KEY when it is invalid and skips re-encryption', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reencrypt = vi.fn(async () => ({ reencrypted: 0, unreadable: 0 }));
    await run(reencrypt, 'invalid');
    expect(reencrypt).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain('SILO_SECRET_KEY');
  });

  it('never throws and never logs the error text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      run(async () => {
        throw new Error('db down sk-test-LEAK-0000');
      }),
    ).resolves.toBeUndefined();
    expect(warn.mock.calls).toEqual([
      ['silo ai: startup key re-encryption failed; AI keys were left as they were'],
    ]);
  });
});
