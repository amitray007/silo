import { createHash } from 'node:crypto';
import type { accessTokens as AccessTokensTable } from '@silo/db';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as TokensOps from './tokens.js';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md):
 * proving only the hash/prefix are ever persisted (never the raw token),
 * hash-lookup verify, revoke, and the best-effort last_used_at bookkeeping
 * are all database-level behaviors mocks can't prove.
 *
 * See `../test-support/pg-harness.ts` for why the module under test is
 * loaded via a dynamic `import()` inside the harness's `beforeAll` — and
 * NOTE: this file must never `import { accessTokens } from '@silo/db'`
 * statically either. `@silo/db`'s barrel (`index.ts`) re-exports `db`/`pool`
 * from the SAME module as the schema tables, so even a type-only-looking
 * static import of a table constant would eagerly evaluate `client.ts`'s
 * top-level `new Pool(...)` against whatever `DATABASE_URL` happens to be
 * set at first import — before the harness's `beforeAll` points it at the
 * disposable database — and silently leak rows into `silo_dev`. `accessTokens`
 * is instead pulled off the dynamically-imported module alongside `ops`.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('access token operations (integration)', () => {
  const harness = setupPgHarness('silo_core_tokens_test', async () => {
    const tokensMod = await import('./tokens.js');
    const dbMod = await import('@silo/db');
    return { ...tokensMod, accessTokens: dbMod.accessTokens };
  });
  let ops: typeof TokensOps;
  let accessTokens: typeof AccessTokensTable;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    const mod = harness.mod();
    ops = mod;
    accessTokens = mod.accessTokens;
    rawDb = harness.rawDb();
    // The shared harness only truncates link_tags/links/tags in its own
    // afterEach (see pg-harness.ts) — access_tokens is a separate table this
    // suite owns, so clear it ourselves between tests for isolation.
    await rawDb.delete(accessTokens);
  });

  describe('generateAccessToken', () => {
    it('returns a raw token once and stores only its hash + prefix (never the raw value)', async () => {
      const created = await ops.generateAccessToken('laptop cli');

      expect(created.name).toBe('laptop cli');
      expect(created.token).toMatch(/^silo_/);
      expect(created.prefix).toBe(created.token.slice(0, ops.TOKEN_PREFIX_LEN));
      expect(created.id).toBeTruthy();
      expect(created.createdAt).toBeInstanceOf(Date);

      const [row] = await rawDb.select().from(accessTokens).where(eq(accessTokens.id, created.id));
      expect(row).toBeDefined();
      // The stored hash must equal sha256(raw) — proving the row derives from
      // the same raw token returned to the caller...
      expect(row?.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'));
      // ...and must NOT equal the raw token itself (no plaintext storage).
      expect(row?.tokenHash).not.toBe(created.token);
      expect(row?.tokenPrefix).toBe(created.prefix);
      expect(row?.lastUsedAt).toBeNull();
    });

    it('trims the name before storing', async () => {
      const created = await ops.generateAccessToken('  raycast  ');
      expect(created.name).toBe('raycast');
    });

    it('rejects a blank name', async () => {
      await expect(ops.generateAccessToken('')).rejects.toThrow(ops.InvalidAccessTokenNameError);
      await expect(ops.generateAccessToken('   ')).rejects.toThrow(ops.InvalidAccessTokenNameError);
    });
  });

  describe('verifyAccessToken', () => {
    it('returns true for a freshly generated token', async () => {
      const created = await ops.generateAccessToken('verify-happy-path');
      expect(await ops.verifyAccessToken(created.token)).toBe(true);
    });

    it('returns false for a wrong/garbage token', async () => {
      await ops.generateAccessToken('verify-wrong-token');
      expect(await ops.verifyAccessToken('silo_not-a-real-token')).toBe(false);
      expect(await ops.verifyAccessToken('')).toBe(false);
    });

    it('sets last_used_at on first verify (null before, set after)', async () => {
      const created = await ops.generateAccessToken('verify-last-used');

      const [before] = await rawDb
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.id, created.id));
      expect(before?.lastUsedAt).toBeNull();

      const ok = await ops.verifyAccessToken(created.token);
      expect(ok).toBe(true);

      const [after] = await rawDb
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.id, created.id));
      expect(after?.lastUsedAt).toBeInstanceOf(Date);
    });

    it('a revoked token no longer verifies', async () => {
      const created = await ops.generateAccessToken('verify-then-revoke');
      expect(await ops.verifyAccessToken(created.token)).toBe(true);

      const revoked = await ops.revokeAccessToken(created.id);
      expect(revoked).toBe(true);

      expect(await ops.verifyAccessToken(created.token)).toBe(false);
    });
  });

  describe('revokeAccessToken', () => {
    it('deletes the row and returns true', async () => {
      const created = await ops.generateAccessToken('to-revoke');
      const result = await ops.revokeAccessToken(created.id);
      expect(result).toBe(true);

      const rows = await rawDb.select().from(accessTokens).where(eq(accessTokens.id, created.id));
      expect(rows).toHaveLength(0);
    });

    it('returns false for an id that does not exist', async () => {
      const result = await ops.revokeAccessToken('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('listAccessTokens', () => {
    it('never exposes the hash or raw token, and orders newest-first', async () => {
      const first = await ops.generateAccessToken('first');
      const second = await ops.generateAccessToken('second');

      const list = await ops.listAccessTokens();
      expect(list.map((t) => t.name)).toEqual(['second', 'first']);

      for (const summary of list) {
        expect(summary).not.toHaveProperty('tokenHash');
        expect(summary).not.toHaveProperty('token');
        expect(Object.keys(summary).sort()).toEqual(
          ['createdAt', 'id', 'lastUsedAt', 'name', 'prefix'].sort(),
        );
      }

      const firstSummary = list.find((t) => t.id === first.id);
      const secondSummary = list.find((t) => t.id === second.id);
      expect(firstSummary?.prefix).toBe(first.prefix);
      expect(secondSummary?.prefix).toBe(second.prefix);
      expect(firstSummary?.lastUsedAt).toBeNull();
    });

    it('returns an empty list when no tokens exist', async () => {
      expect(await ops.listAccessTokens()).toEqual([]);
    });
  });
});
