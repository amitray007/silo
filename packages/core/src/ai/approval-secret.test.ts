import { afterEach, expect, it, vi } from 'vitest';
import { librarianApprovalSecret } from './secret-box.js';

afterEach(() => vi.unstubAllEnvs());
it('derives a stable domain-separated 32-byte secret', () => {
  vi.stubEnv('SILO_SECRET_KEY', Buffer.alloc(32, 7).toString('base64'));
  const a = librarianApprovalSecret();
  expect(a).toHaveLength(32);
  expect(librarianApprovalSecret()).toEqual(a);
  expect(a).not.toEqual(new Uint8Array(32).fill(7));
});
it('omits the secret with no key or an invalid key', () => {
  vi.stubEnv('SILO_SECRET_KEY', '');
  expect(librarianApprovalSecret()).toBeUndefined();
  vi.stubEnv('SILO_SECRET_KEY', 'bad');
  expect(librarianApprovalSecret()).toBeUndefined();
});
