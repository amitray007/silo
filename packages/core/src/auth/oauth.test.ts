import { createHash } from 'node:crypto';
import type {
  accessTokens as AccessTokensTable,
  oauthClients as OAuthClientsTable,
  oauthCodes as OAuthCodesTable,
} from '@silo/db';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as OAuthOps from './oauth.js';

const RESOURCE = 'https://mcp.example.com/mcp';

/**
 * Integration tests against a real Postgres (see docs/rules/testing.md).
 * `verifyPkce`/`canonicalMcpResource`/`generateOpaque` are pure and don't
 * strictly need a DB, but `oauth.ts` (unlike `tokens.ts`) has a top-level
 * `import ... from '@silo/db'` — `@silo/db`'s `client.ts` throws at
 * MODULE-LOAD time if `DATABASE_URL` is unset, so even a static import of
 * just the pure exports would crash before `beforeAll` gets a chance to set
 * it (see `../test-support/pg-harness.ts`'s doc comment for the same trap
 * on `tokens.test.ts`). So every export here — pure or not — is exercised
 * via the harness's dynamically-imported `ops`, and the whole file skips
 * (not fails) when no local Postgres is reachable.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('oauth core logic (integration)', () => {
  const harness = setupPgHarness('silo_core_oauth_test', async () => {
    const oauthMod = await import('./oauth.js');
    const dbMod = await import('@silo/db');
    return {
      ...oauthMod,
      accessTokens: dbMod.accessTokens,
      oauthClients: dbMod.oauthClients,
      oauthCodes: dbMod.oauthCodes,
    };
  });
  let ops: typeof OAuthOps;
  let accessTokens: typeof AccessTokensTable;
  let oauthClients: typeof OAuthClientsTable;
  let oauthCodes: typeof OAuthCodesTable;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    const mod = harness.mod();
    ops = mod;
    accessTokens = mod.accessTokens;
    oauthClients = mod.oauthClients;
    oauthCodes = mod.oauthCodes;
    rawDb = harness.rawDb();
    // The shared harness's own afterEach only truncates link_tags/links/tags
    // — these three tables are this suite's own, clear them for isolation.
    // oauth_codes/access_tokens reference oauth_clients, so clear in FK order.
    await rawDb.delete(oauthCodes);
    await rawDb.delete(accessTokens);
    await rawDb.delete(oauthClients);
  });

  async function registerClient(name = 'Claude') {
    return ops.registerOAuthClient({
      clientName: name,
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    });
  }

  describe('verifyPkce (pure)', () => {
    it('accepts a verifier whose S256 hash matches the challenge', () => {
      // Fixture from RFC 7636 appendix B.
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
      expect(ops.verifyPkce(verifier, challenge, 'S256')).toBe(true);
    });

    it('rejects a verifier that does not hash to the challenge', () => {
      expect(
        ops.verifyPkce('wrong-verifier', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'S256'),
      ).toBe(false);
    });

    it('rejects any method other than S256 (including plain)', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      expect(ops.verifyPkce(verifier, verifier, 'plain')).toBe(false);
      expect(ops.verifyPkce(verifier, verifier, '')).toBe(false);
    });
  });

  describe('canonicalMcpResource (pure)', () => {
    it('appends /mcp to a bare origin', () => {
      expect(ops.canonicalMcpResource('https://mcp.example.com')).toBe(
        'https://mcp.example.com/mcp',
      );
    });

    it('strips a trailing slash before appending /mcp', () => {
      expect(ops.canonicalMcpResource('https://mcp.example.com/')).toBe(
        'https://mcp.example.com/mcp',
      );
    });

    it('is idempotent when already canonical', () => {
      expect(ops.canonicalMcpResource('https://mcp.example.com/mcp')).toBe(
        'https://mcp.example.com/mcp',
      );
    });

    it('strips a trailing slash after /mcp', () => {
      expect(ops.canonicalMcpResource('https://mcp.example.com/mcp/')).toBe(
        'https://mcp.example.com/mcp',
      );
    });
  });

  describe('generateOpaque (pure)', () => {
    it('prefixes the given string and returns hex-encoded random bytes of the requested length', () => {
      const token = ops.generateOpaque('oat_', 32);
      expect(token.startsWith('oat_')).toBe(true);
      expect(token.slice(4)).toHaveLength(64); // 32 bytes -> 64 hex chars
    });

    it('produces distinct values on successive calls', () => {
      expect(ops.generateOpaque('cli_')).not.toBe(ops.generateOpaque('cli_'));
    });
  });

  describe('registerOAuthClient / getOAuthClient', () => {
    it('registers a public client with a cli_ id and no secret', async () => {
      const client = await registerClient();
      expect(client.id).toMatch(/^cli_/);
      expect(client.name).toBe('Claude');
      expect(client.tokenEndpointAuthMethod).toBe('none');
      expect(client.grantTypes).toEqual(['authorization_code', 'refresh_token']);
    });

    it('round-trips through getOAuthClient', async () => {
      const client = await registerClient();
      const fetched = await ops.getOAuthClient(client.id);
      expect(fetched?.id).toBe(client.id);
      expect(fetched?.redirectUris).toEqual(client.redirectUris);
    });

    it('returns null for an unknown client id', async () => {
      expect(await ops.getOAuthClient('cli_does-not-exist')).toBeNull();
    });
  });

  describe('createAuthCode / consumeAuthCode', () => {
    it('consumes a valid code exactly once — a replay fails', async () => {
      const client = await registerClient();
      const code = await ops.createAuthCode({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? '',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      });
      expect(code).toMatch(/^oac_/);

      const first = await ops.consumeAuthCode(code);
      expect(first?.clientId).toBe(client.id);
      expect(first?.resource).toBe(RESOURCE);

      const replay = await ops.consumeAuthCode(code);
      expect(replay).toBeNull();
    });

    it('returns null for an unknown code', async () => {
      expect(await ops.consumeAuthCode('oac_never-issued')).toBeNull();
    });

    it('rejects an expired code', async () => {
      const client = await registerClient();
      const code = await ops.createAuthCode({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? '',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      });

      // Force the row into the past directly — createAuthCode itself always
      // sets a future expiry, so this is the only way to exercise expiry.
      await rawDb
        .update(oauthCodes)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(oauthCodes.code, code));

      expect(await ops.consumeAuthCode(code)).toBeNull();
    });
  });

  describe('issueOAuthTokens', () => {
    it('issues an oat_/ort_ pair, stores only hashes, and returns the raw values once', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      expect(issued.accessToken).toMatch(/^oat_/);
      expect(issued.refreshToken).toMatch(/^ort_/);
      expect(issued.scope).toBe('silo');
      expect(issued.accessExpiresIn).toBe(60 * 60);
      expect(issued.refreshExpiresIn).toBe(30 * 24 * 60 * 60);

      const rows = await rawDb
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.clientId, client.id));
      expect(rows).toHaveLength(2);

      const accessRow = rows.find((r) => r.kind === 'oauth_access');
      const refreshRow = rows.find((r) => r.kind === 'oauth_refresh');
      expect(accessRow?.tokenHash).toBe(
        createHash('sha256').update(issued.accessToken).digest('hex'),
      );
      expect(refreshRow?.tokenHash).toBe(
        createHash('sha256').update(issued.refreshToken).digest('hex'),
      );
      // The access row remembers its paired refresh token's hash.
      expect(accessRow?.refreshTokenHash).toBe(refreshRow?.tokenHash);
      expect(accessRow?.resource).toBe(RESOURCE);
    });
  });

  describe('authenticateOAuthToken', () => {
    it('accepts a fresh access token against its bound resource', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      expect(await ops.authenticateOAuthToken(issued.accessToken, RESOURCE)).toBe(true);
    });

    it('rejects a token bound to a different resource (audience mismatch)', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      expect(
        await ops.authenticateOAuthToken(issued.accessToken, 'https://mcp.other.com/mcp'),
      ).toBe(false);
    });

    it('rejects an unknown/garbage token', async () => {
      expect(await ops.authenticateOAuthToken('oat_not-real', RESOURCE)).toBe(false);
    });

    it('rejects an expired access token', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      const hash = createHash('sha256').update(issued.accessToken).digest('hex');
      await rawDb
        .update(accessTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(accessTokens.tokenHash, hash));

      expect(await ops.authenticateOAuthToken(issued.accessToken, RESOURCE)).toBe(false);
    });

    it('rejects a refresh token presented as an access token', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      expect(await ops.authenticateOAuthToken(issued.refreshToken, RESOURCE)).toBe(false);
    });

    it('does not throw and still returns true if last_used_at bookkeeping is stale (best-effort)', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      // First auth sets last_used_at; a second auth call must still succeed.
      expect(await ops.authenticateOAuthToken(issued.accessToken, RESOURCE)).toBe(true);
      expect(await ops.authenticateOAuthToken(issued.accessToken, RESOURCE)).toBe(true);
    });
  });

  describe('rotateRefreshToken', () => {
    it('issues a fresh pair and invalidates the old access+refresh pair', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const rotated = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });

      expect(rotated).not.toBeNull();
      expect(rotated?.accessToken).not.toBe(issued.accessToken);
      expect(rotated?.refreshToken).not.toBe(issued.refreshToken);

      // Old pair no longer authenticates / cannot be re-rotated.
      expect(await ops.authenticateOAuthToken(issued.accessToken, RESOURCE)).toBe(false);
      const replay = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(replay).toBeNull();

      // New pair works.
      expect(await ops.authenticateOAuthToken(rotated?.accessToken ?? '', RESOURCE)).toBe(true);
    });

    it('rejects rotation for the wrong client', async () => {
      const client = await registerClient();
      const other = await registerClient('ChatGPT');
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const result = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: other.id,
        resource: RESOURCE,
      });
      expect(result).toBeNull();
    });

    it('rejects rotation with a mismatched resource', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const result = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: 'https://mcp.other.com/mcp',
      });
      expect(result).toBeNull();
    });

    it('rejects an unknown refresh token', async () => {
      const client = await registerClient();
      const result = await ops.rotateRefreshToken({
        refreshToken: 'ort_never-issued',
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(result).toBeNull();
    });
  });

  describe('listOAuthClientsForOwner', () => {
    it('dedups multiple cli_ registrations under the same (case-insensitive) name into one group', async () => {
      const claude1 = await registerClient('Claude');
      const claude2 = await registerClient('claude'); // re-registration, different case
      const chatgpt = await registerClient('ChatGPT');

      await ops.issueOAuthTokens({ clientId: claude1.id, resource: RESOURCE });
      await ops.issueOAuthTokens({ clientId: claude2.id, resource: RESOURCE });
      await ops.issueOAuthTokens({ clientId: chatgpt.id, resource: RESOURCE });

      const groups = await ops.listOAuthClientsForOwner();
      expect(groups).toHaveLength(2);

      const claudeGroup = groups.find((g) => g.clientName.toLowerCase() === 'claude');
      expect(claudeGroup?.clientIds.sort()).toEqual([claude1.id, claude2.id].sort());
      expect(claudeGroup?.connectionCount).toBe(2);
      expect(claudeGroup?.activeTokenCount).toBe(2);

      const chatgptGroup = groups.find((g) => g.clientName.toLowerCase() === 'chatgpt');
      expect(chatgptGroup?.clientIds).toEqual([chatgpt.id]);
      expect(chatgptGroup?.connectionCount).toBe(1);
    });

    it('reports the earliest grantedAt and latest lastUsedAt within a group', async () => {
      const first = await registerClient('Claude');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = await registerClient('Claude');

      const issuedFirst = await ops.issueOAuthTokens({ clientId: first.id, resource: RESOURCE });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await ops.issueOAuthTokens({ clientId: second.id, resource: RESOURCE });

      // Use the older (first-issued) token so lastUsedAt reflects a use
      // strictly after the second token's own createdAt, proving the group's
      // lastUsedAt is a real max, not just "whichever row was scanned last".
      await ops.authenticateOAuthToken(issuedFirst.accessToken, RESOURCE);

      const groups = await ops.listOAuthClientsForOwner();
      const group = groups.find((g) => g.clientName === 'Claude');
      expect(group?.grantedAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(group?.lastUsedAt).not.toBeNull();
    });

    it('excludes non-expired-only count correctly when a token has expired', async () => {
      const client = await registerClient('Claude');
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      const hash = createHash('sha256').update(issued.accessToken).digest('hex');
      await rawDb
        .update(accessTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(accessTokens.tokenHash, hash));

      const groups = await ops.listOAuthClientsForOwner();
      const group = groups.find((g) => g.clientName === 'Claude');
      expect(group?.activeTokenCount).toBe(0);
    });

    it('returns an empty list when nothing is connected', async () => {
      expect(await ops.listOAuthClientsForOwner()).toEqual([]);
    });

    it('sorts most-recently-granted group first', async () => {
      const older = await registerClient('Older App');
      await ops.issueOAuthTokens({ clientId: older.id, resource: RESOURCE });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const newer = await registerClient('Newer App');
      await ops.issueOAuthTokens({ clientId: newer.id, resource: RESOURCE });

      const groups = await ops.listOAuthClientsForOwner();
      expect(groups.map((g) => g.clientName)).toEqual(['Newer App', 'Older App']);
    });
  });

  describe('revokeOAuthClient', () => {
    it('deletes all tokens for that client only', async () => {
      const client = await registerClient('Claude');
      const other = await registerClient('ChatGPT');
      await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      const otherIssued = await ops.issueOAuthTokens({ clientId: other.id, resource: RESOURCE });

      await ops.revokeOAuthClient(client.id);

      const groups = await ops.listOAuthClientsForOwner();
      expect(groups).toHaveLength(1);
      expect(groups[0]?.clientName).toBe('ChatGPT');
      expect(await ops.authenticateOAuthToken(otherIssued.accessToken, RESOURCE)).toBe(true);
    });

    it('leaves the oauth_clients row in place (harmless stale client)', async () => {
      const client = await registerClient('Claude');
      await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      await ops.revokeOAuthClient(client.id);

      expect(await ops.getOAuthClient(client.id)).not.toBeNull();
    });
  });

  describe('revokeAllOAuthClients', () => {
    it('deletes every OAuth token across every client but leaves bearer tokens untouched', async () => {
      const claude = await registerClient('Claude');
      const chatgpt = await registerClient('ChatGPT');
      const claudeIssued = await ops.issueOAuthTokens({ clientId: claude.id, resource: RESOURCE });
      const chatgptIssued = await ops.issueOAuthTokens({
        clientId: chatgpt.id,
        resource: RESOURCE,
      });

      // A pre-existing manual bearer token (kind='bearer', no client) must survive.
      await rawDb.insert(accessTokens).values({
        name: 'manual cli token',
        tokenHash: createHash('sha256').update('silo_manual-token').digest('hex'),
        tokenPrefix: 'silo_manual',
      });

      await ops.revokeAllOAuthClients();

      expect(await ops.listOAuthClientsForOwner()).toEqual([]);
      expect(await ops.authenticateOAuthToken(claudeIssued.accessToken, RESOURCE)).toBe(false);
      expect(await ops.authenticateOAuthToken(chatgptIssued.accessToken, RESOURCE)).toBe(false);

      const remaining = await rawDb.select().from(accessTokens);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.kind).toBe('bearer');
    });
  });
});
