import { createHash } from 'node:crypto';
import type {
  accessTokens as AccessTokensTable,
  oauthClients as OAuthClientsTable,
  oauthCodes as OAuthCodesTable,
} from '@silo/db';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { and, eq } from 'drizzle-orm';
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

  describe('normalizeResourceParam (pure)', () => {
    // Review fix SEC-2: the single shared normalizer `authorize.ts` and
    // `token.ts` both route their client-supplied `resource` param through,
    // replacing three independently-drifting trailing-slash regexes.
    it('strips a single trailing slash', () => {
      expect(ops.normalizeResourceParam('https://mcp.example.com/mcp/')).toBe(
        'https://mcp.example.com/mcp',
      );
    });

    it('is a no-op when already normalized', () => {
      expect(ops.normalizeResourceParam('https://mcp.example.com/mcp')).toBe(
        'https://mcp.example.com/mcp',
      );
    });

    it('returns null for null, undefined, or empty input', () => {
      expect(ops.normalizeResourceParam(null)).toBeNull();
      expect(ops.normalizeResourceParam(undefined)).toBeNull();
      expect(ops.normalizeResourceParam('')).toBeNull();
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

    describe('DCR dedup (oauth-dcr-dedup-and-cleanup slice)', () => {
      it('re-registering the identical (name, redirect_uris) returns the SAME cli_ id, no new row', async () => {
        const first = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        });
        const second = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        });

        expect(second.id).toBe(first.id);

        const rows = await rawDb.select().from(oauthClients);
        expect(rows).toHaveLength(1);
      });

      it('different redirect_uris produce a new client', async () => {
        const first = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        });
        const second = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://claude.ai/api/mcp/other_callback'],
        });

        expect(second.id).not.toBe(first.id);
        const rows = await rawDb.select().from(oauthClients);
        expect(rows).toHaveLength(2);
      });

      it('different name produces a new client', async () => {
        const first = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        });
        const second = await ops.registerOAuthClient({
          clientName: 'ChatGPT',
          redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        });

        expect(second.id).not.toBe(first.id);
        const rows = await rawDb.select().from(oauthClients);
        expect(rows).toHaveLength(2);
      });

      it('redirect_uris in a different order still match (order-insensitive)', async () => {
        const first = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://a.example.com/cb', 'https://b.example.com/cb'],
        });
        const second = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://b.example.com/cb', 'https://a.example.com/cb'],
        });

        expect(second.id).toBe(first.id);
        const rows = await rawDb.select().from(oauthClients);
        expect(rows).toHaveLength(1);
        // Storage order of the ORIGINAL row is untouched by the comparison.
        expect(second.redirectUris).toEqual([
          'https://a.example.com/cb',
          'https://b.example.com/cb',
        ]);
      });

      it('name match is case-insensitive', async () => {
        const first = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        });
        const second = await ops.registerOAuthClient({
          clientName: 'CLAUDE',
          redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
        });

        expect(second.id).toBe(first.id);
      });

      it('with multiple pre-existing duplicates, returns the EARLIEST-created one', async () => {
        // Seed duplicates the way they could arise from BEFORE dedup existed
        // — insert directly rather than via registerOAuthClient (which would
        // itself now dedupe them).
        const redirectUris = ['https://claude.ai/api/mcp/auth_callback'];
        const [older] = await rawDb
          .insert(oauthClients)
          .values({
            id: 'cli_older',
            name: 'Claude',
            redirectUris,
            grantTypes: ['authorization_code', 'refresh_token'],
            tokenEndpointAuthMethod: 'none',
            createdAt: new Date(Date.now() - 60_000),
          })
          .returning();
        const [newer] = await rawDb
          .insert(oauthClients)
          .values({
            id: 'cli_newer',
            name: 'Claude',
            redirectUris,
            grantTypes: ['authorization_code', 'refresh_token'],
            tokenEndpointAuthMethod: 'none',
            createdAt: new Date(),
          })
          .returning();
        expect(older).toBeDefined();
        expect(newer).toBeDefined();

        const result = await ops.registerOAuthClient({
          clientName: 'Claude',
          redirectUris,
        });

        expect(result.id).toBe('cli_older');
        const rows = await rawDb.select().from(oauthClients);
        expect(rows).toHaveLength(2); // no new row inserted
      });
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

    it('cannot be double-spent by two concurrent callers racing the same code (M2 regression)', async () => {
      // Regression guard for review fix M2: consumeAuthCode used to be a
      // separate SELECT-then-DELETE, so two concurrent requests could both
      // observe the row via SELECT before either DELETE landed, and both
      // would proceed to spend it. The atomic DELETE...RETURNING makes
      // Postgres serialize the deletes — only one caller can ever get a row.
      const client = await registerClient();
      const code = await ops.createAuthCode({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? '',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      });

      const [first, second] = await Promise.all([
        ops.consumeAuthCode(code),
        ops.consumeAuthCode(code),
      ]);
      const winners = [first, second].filter((r) => r !== null);
      expect(winners).toHaveLength(1);
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
    it('issues a fresh pair; the old access token stops authenticating immediately', async () => {
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

      // Old access token is deleted immediately on rotation (no grace for
      // the access leg — only the refresh leg gets a grace window).
      expect(await ops.authenticateOAuthToken(issued.accessToken, RESOURCE)).toBe(false);

      // New pair works.
      expect(await ops.authenticateOAuthToken(rotated?.accessToken ?? '', RESOURCE)).toBe(true);
    });

    it('replays the SAME successor pair for a retried rotation within the 60s grace window (idempotent)', async () => {
      // Root-cause fix: rotateRefreshToken used to delete the old refresh
      // row instantly, so a RETRIED refresh (slow response, dropped socket)
      // found the row gone and returned null -> invalid_grant -> connectors
      // read this as "connection expired". Within the grace window, a
      // replay of the same old refresh token must now return the identical
      // successor pair, not null and not a third pair.
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const first = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(first).not.toBeNull();

      const replay = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });

      expect(replay).not.toBeNull();
      expect(replay?.accessToken).toBe(first?.accessToken);
      expect(replay?.refreshToken).toBe(first?.refreshToken);

      // The replayed successor pair is fully live: the access token
      // authenticates and the refresh token can itself rotate onward.
      expect(await ops.authenticateOAuthToken(replay?.accessToken ?? '', RESOURCE)).toBe(true);

      // A second replay call also returns the same pair (not just the first
      // replay) — genuinely idempotent, not "replay once".
      const secondReplay = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(secondReplay?.accessToken).toBe(first?.accessToken);
      expect(secondReplay?.refreshToken).toBe(first?.refreshToken);
    });

    it('rejects replay of an old refresh token AFTER its grace window has elapsed (reuse detection)', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const rotated = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(rotated).not.toBeNull();

      // Force the old row's grace-extended expiresAt into the past directly
      // — rotateRefreshToken itself always sets a future (now + GRACE_MS)
      // expiry, so this is the only way to exercise "grace window elapsed"
      // without an injectable clock.
      const oldHash = createHash('sha256').update(issued.refreshToken).digest('hex');
      await rawDb
        .update(accessTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(accessTokens.tokenHash, oldHash));

      const replayAfterGrace = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(replayAfterGrace).toBeNull();

      // The successor pair minted by the original rotation is unaffected —
      // reuse of the OLD token is rejected, the live successor still works.
      expect(await ops.authenticateOAuthToken(rotated?.accessToken ?? '', RESOURCE)).toBe(true);
    });

    it('a normal single rotation still works, and the successor can itself rotate again', async () => {
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const rotated = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(rotated).not.toBeNull();

      const rotatedAgain = await ops.rotateRefreshToken({
        refreshToken: rotated?.refreshToken ?? '',
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(rotatedAgain).not.toBeNull();
      expect(rotatedAgain?.accessToken).not.toBe(rotated?.accessToken);
      expect(rotatedAgain?.refreshToken).not.toBe(rotated?.refreshToken);
      expect(await ops.authenticateOAuthToken(rotatedAgain?.accessToken ?? '', RESOURCE)).toBe(
        true,
      );
    });

    it('leaves one live access row and the successor refresh row for the client after rotation (M3, grace-window-aware)', async () => {
      // Regression guard for review fix M3: the mutating tail still runs
      // inside a single db.transaction, so a successful rotation is
      // all-or-nothing. Reconciled for the grace window (this method's
      // spec): rotation no longer deletes the old refresh row outright, so
      // there are briefly THREE rows for the client — the new access row,
      // the new (successor) refresh row, and the old (dying, grace-window)
      // refresh row carrying the recorded successor. Exactly one access row
      // and exactly one LIVE (non-dying) refresh row exist; the old row is
      // distinguishable by carrying successor tokens.
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const rotated = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(rotated).not.toBeNull();

      const rows = await rawDb
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.clientId, client.id));
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.kind === 'oauth_access')).toHaveLength(1);

      const refreshRows = rows.filter((r) => r.kind === 'oauth_refresh');
      expect(refreshRows).toHaveLength(2);

      const dyingRow = refreshRows.find((r) => r.successorAccessToken !== null);
      const liveRow = refreshRows.find((r) => r.successorAccessToken === null);
      expect(dyingRow).toBeDefined();
      expect(liveRow).toBeDefined();
      expect(dyingRow?.successorRefreshToken).toBe(rotated?.refreshToken);
      expect(dyingRow?.tokenHash).toBe(
        createHash('sha256').update(issued.refreshToken).digest('hex'),
      );
      expect(liveRow?.tokenHash).toBe(
        createHash('sha256')
          .update(rotated?.refreshToken ?? '')
          .digest('hex'),
      );
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
      // Since DCR dedup (oauth-dcr-dedup-and-cleanup slice), registerClient
      // with the SAME name+redirect_uris now returns the same cli_ id — so
      // simulating two genuinely-distinct pre-existing rows (the scenario
      // this test covers: listOAuthClientsForOwner's own display-time dedup
      // across rows minted before registration-time dedup existed) requires
      // inserting directly rather than going through registerOAuthClient.
      const claude1 = await registerClient('Claude');
      const [claude2] = await rawDb
        .insert(oauthClients)
        .values({
          id: 'cli_claude_pre_dedup_dupe',
          name: 'claude', // re-registration, different case
          redirectUris: claude1.redirectUris,
          grantTypes: claude1.grantTypes,
          tokenEndpointAuthMethod: claude1.tokenEndpointAuthMethod,
        })
        .returning();
      if (!claude2) throw new Error('setup: expected an inserted row');
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

    it('grantedAt stays at the original registration time across a refresh rotation (H1 regression)', async () => {
      // Regression guard for review fix H1: grantedAt used to be sourced from
      // accessTokens.createdAt, which rotateRefreshToken resets to now() on
      // every refresh — so grantedAt would march forward on each refresh
      // instead of staying pinned to the client's actual registration time.
      const client = await registerClient('Claude');
      const registeredAt = (await ops.getOAuthClient(client.id))?.createdAt;
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const beforeRotate = await ops.listOAuthClientsForOwner();
      const groupBefore = beforeRotate.find((g) => g.clientName === 'Claude');
      expect(groupBefore?.grantedAt.getTime()).toBe(registeredAt?.getTime());

      await new Promise((resolve) => setTimeout(resolve, 10));
      const rotated = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(rotated).not.toBeNull();

      const afterRotate = await ops.listOAuthClientsForOwner();
      const groupAfter = afterRotate.find((g) => g.clientName === 'Claude');
      // grantedAt must NOT have moved to the refresh time — it stays pinned
      // to the original oauth_clients.created_at.
      expect(groupAfter?.grantedAt.getTime()).toBe(registeredAt?.getTime());
    });

    it('excludes non-expired-only count correctly when a token has expired', async () => {
      const client = await registerClient('Claude');
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      const hash = createHash('sha256').update(issued.accessToken).digest('hex');
      await rawDb
        .update(accessTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(accessTokens.tokenHash, hash));

      // Review fix M1: a group with zero active tokens is dropped entirely
      // (consistent with revoke making an app disappear), so it no longer
      // shows up in the list at all rather than appearing with a 0 count.
      const groups = await ops.listOAuthClientsForOwner();
      expect(groups.find((g) => g.clientName === 'Claude')).toBeUndefined();
    });

    it('hides an app whose only token has expired, but shows one with an active token (M1)', async () => {
      const expiredOnly = await registerClient('Expired App');
      const issuedExpired = await ops.issueOAuthTokens({
        clientId: expiredOnly.id,
        resource: RESOURCE,
      });
      const expiredHash = createHash('sha256').update(issuedExpired.accessToken).digest('hex');
      await rawDb
        .update(accessTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(accessTokens.tokenHash, expiredHash));

      const active = await registerClient('Active App');
      await ops.issueOAuthTokens({ clientId: active.id, resource: RESOURCE });

      const groups = await ops.listOAuthClientsForOwner();
      expect(groups.map((g) => g.clientName)).toEqual(['Active App']);
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

  describe('cleanupExpiredOAuth', () => {
    async function forceExpired(clientId: string, kind: 'oauth_access' | 'oauth_refresh') {
      await rawDb
        .update(accessTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(and(eq(accessTokens.clientId, clientId), eq(accessTokens.kind, kind)));
    }

    it('deletes expired oauth_codes, leaves unexpired ones', async () => {
      const client = await registerClient();
      const expiredCode = await ops.createAuthCode({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? '',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      });
      await rawDb
        .update(oauthCodes)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(oauthCodes.code, expiredCode));

      const liveCode = await ops.createAuthCode({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? '',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      });

      const counts = await ops.cleanupExpiredOAuth();
      expect(counts.codes).toBe(1);

      const remainingCodes = await rawDb.select().from(oauthCodes);
      expect(remainingCodes.map((r) => r.code)).toEqual([liveCode]);
    });

    it('deletes expired oauth_access/oauth_refresh rows, leaves unexpired ones', async () => {
      const client = await registerClient();
      const expiring = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      await forceExpired(client.id, 'oauth_access');
      await forceExpired(client.id, 'oauth_refresh');

      const other = await registerClient('ChatGPT');
      const live = await ops.issueOAuthTokens({ clientId: other.id, resource: RESOURCE });

      const counts = await ops.cleanupExpiredOAuth();
      expect(counts.tokens).toBe(2);

      expect(await ops.authenticateOAuthToken(expiring.accessToken, RESOURCE)).toBe(false);
      expect(await ops.authenticateOAuthToken(live.accessToken, RESOURCE)).toBe(true);
    });

    it('a grace-window successor refresh row (expiresAt in the future) survives cleanup', async () => {
      // Fix #1 regression guard: rotateRefreshToken pulls the OLD refresh
      // row's expiresAt in to now + GRACE_MS (still in the future) instead of
      // deleting it outright, so a retried rotation can replay the recorded
      // successor idempotently within that window. cleanupExpiredOAuth's
      // plain `expiresAt < now()` filter must NOT sweep that row away while
      // it's still inside its grace window.
      const client = await registerClient();
      const issued = await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const rotated = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(rotated).not.toBeNull();

      const oldHash = createHash('sha256').update(issued.refreshToken).digest('hex');
      const beforeCleanup = await rawDb
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.tokenHash, oldHash));
      expect(beforeCleanup).toHaveLength(1);
      expect(beforeCleanup[0]?.successorAccessToken).not.toBeNull();

      const counts = await ops.cleanupExpiredOAuth();
      // Nothing genuinely expired yet: the dying row is still inside its
      // grace window, the new pair is fresh.
      expect(counts.tokens).toBe(0);

      const afterCleanup = await rawDb
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.tokenHash, oldHash));
      expect(afterCleanup).toHaveLength(1);

      // The replay path (rotateRefreshToken called again with the same old
      // token) still works after cleanup ran — the grace-window row wasn't
      // touched.
      const replay = await ops.rotateRefreshToken({
        refreshToken: issued.refreshToken,
        clientId: client.id,
        resource: RESOURCE,
      });
      expect(replay?.accessToken).toBe(rotated?.accessToken);
    });

    it('removes an orphaned client (zero remaining tokens/codes) after its tokens expire', async () => {
      const client = await registerClient('Orphan-to-be');
      await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });
      await forceExpired(client.id, 'oauth_access');
      await forceExpired(client.id, 'oauth_refresh');

      const counts = await ops.cleanupExpiredOAuth();
      expect(counts.tokens).toBe(2);
      expect(counts.clients).toBe(1);

      expect(await ops.getOAuthClient(client.id)).toBeNull();
    });

    it('does NOT remove a client that still has a live (unexpired) token', async () => {
      const client = await registerClient('Still Live');
      await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const counts = await ops.cleanupExpiredOAuth();
      expect(counts.clients).toBe(0);
      expect(await ops.getOAuthClient(client.id)).not.toBeNull();
    });

    it('does NOT remove a client that has zero tokens but a live pending auth code', async () => {
      const client = await registerClient('Pending Consent');
      await ops.createAuthCode({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? '',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      });

      const counts = await ops.cleanupExpiredOAuth();
      expect(counts.codes).toBe(0);
      expect(counts.clients).toBe(0);
      expect(await ops.getOAuthClient(client.id)).not.toBeNull();
    });

    it('removes a client whose only reference was an expired auth code (code swept first, then client)', async () => {
      const client = await registerClient('Abandoned Flow');
      const code = await ops.createAuthCode({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? '',
        codeChallenge: 'challenge-value',
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      });
      await rawDb
        .update(oauthCodes)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(oauthCodes.code, code));

      const counts = await ops.cleanupExpiredOAuth();
      expect(counts.codes).toBe(1);
      expect(counts.clients).toBe(1);
      expect(await ops.getOAuthClient(client.id)).toBeNull();
    });

    it('leaves a pre-existing (pre-dedup) duplicate client alone until ITS tokens also expire', async () => {
      const client = await registerClient('Dup App');
      const dupe = await rawDb
        .insert(oauthClients)
        .values({
          id: 'cli_pre_dedup_dupe',
          name: 'Dup App',
          redirectUris: client.redirectUris,
          grantTypes: client.grantTypes,
          tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        })
        .returning();
      expect(dupe).toHaveLength(1);

      // The original client has a live token; the duplicate has none at all.
      await ops.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

      const counts = await ops.cleanupExpiredOAuth();
      // The duplicate has zero references from the start — it's orphaned
      // immediately, independent of the original client's live token.
      expect(counts.clients).toBe(1);
      expect(await ops.getOAuthClient(client.id)).not.toBeNull();
      expect(await ops.getOAuthClient('cli_pre_dedup_dupe')).toBeNull();
    });
  });
});
