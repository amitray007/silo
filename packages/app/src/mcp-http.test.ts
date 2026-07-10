import type { Server } from 'node:http';
import * as http from 'node:http';
import { runMigrations } from '@silo/db/migrate';
import * as disposableDb from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// `{ spy: true }` auto-spies every export of `@silo/core` with a real
// passthrough implementation (vitest 3+) rather than replacing the module
// wholesale — `@silo/core` is transitively huge (it's what `@silo/mcp-server`
// itself needs), and a full `vi.mock` would force hand-stubbing everything
// `startMcpHttpServer` transitively touches (settings, `timingSafeEqual`,
// etc). With `spy: true`, every export keeps its real behavior by default;
// the one fail-closed test below overrides only `getSetting` for a single
// call via `mockRejectedValueOnce`, and every other test in this file (and
// the disposable-DB-backed `setSetting`/`getSetting` calls in `afterEach`)
// keeps hitting the real implementation against the real disposable DB.
vi.mock('@silo/core', { spy: true });

/**
 * Tests for the token-gated HTTP MCP listener (MCP-HTTP slice, U2; `mcpAccess`
 * gate added in the per-request settings-gate slice). Drives real HTTP
 * requests (via `fetch`) against an ephemeral-port instance —
 * `startMcpHttpServer` transitively imports `@silo/mcp-server` -> `@silo/core`
 * -> `@silo/db`, and now `routeMcpRequest` itself calls core's `getSetting`
 * on every request, so (unlike before the gate existed) this suite needs a
 * REAL, reachable Postgres — a syntactically valid placeholder URL is no
 * longer enough. Uses the same disposable-database pattern as
 * `turnkey.test.ts`: a fresh, uniquely-named, migrated database per run,
 * dropped in `afterAll`. `@silo/core`'s `db`/`pool` singleton reads
 * `DATABASE_URL` at module-load time, so `@silo/core` and `@silo/mcp-server`
 * are only imported (via `startMcpHttpServer`, dynamically imported inside
 * `startTestServer`) AFTER `DATABASE_URL` is pointed at the disposable DB.
 */
const describeIfPg = disposableDb.postgresReachable() ? describe : describe.skip;

const TOKEN = 'mcp-http-test-token-do-not-use-in-prod';

let server: Server | undefined;
let dropDatabase: (() => void) | undefined;

beforeAll(async () => {
  const database = disposableDb.createDisposableDatabase('silo_app_mcp_http_test');
  const migratePool = new Pool({ connectionString: database.url });
  await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

  process.env.DATABASE_URL = database.url;
  dropDatabase = database.drop;
});

afterAll(async () => {
  // Close the real `@silo/db` singleton pool (this suite's `startMcpHttpServer`
  // runs `@silo/core` against it) BEFORE dropping the disposable DB, so
  // `DROP DATABASE ... WITH (FORCE)` doesn't force-terminate its idle
  // connections and fire the pool's `error` handler as a stray async error
  // (mis-attributed to a later test under CI parallel load). `@silo/db` is NOT
  // covered by this file's `vi.mock('@silo/core', { spy: true })`, so this
  // imports the real pool. Same root-cause fix as `worker.test.ts`/
  // `turnkey.test.ts`/`setupPgHarness`.
  const { pool: opsPool } = await import('@silo/db');
  await opsPool.end();
  dropDatabase?.();
});

afterEach(async () => {
  if (server !== undefined) {
    const toClose = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      toClose.close((error) => (error ? reject(error) : resolve()));
    });
  }

  // Reset mcpAccess to its default (true) after any test that changes it, so
  // suites never poison each other's default-on assumption.
  const core = await import('@silo/core');
  await core.setSetting('mcpAccess', true);
});

async function startTestServer(): Promise<{ baseUrl: string; port: number }> {
  const { startMcpHttpServer } = await import('./mcp-http.js');
  server = startMcpHttpServer({ port: 0, token: TOKEN, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected an ephemeral TCP address');
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, port: address.port };
}

/** Issues a raw `node:http` POST request with a caller-controlled `Host`
 * header. `fetch` (and most HTTP clients) refuse to let a caller override the
 * `Host` header — it's derived from the URL — which makes it useless for
 * exercising the SDK's DNS-rebinding `Host`-header check from a test. Node's
 * `http.request` has no such restriction: passing `Host` in `headers`
 * overrides the header Node would otherwise derive from `options.host`. */
function postWithHostHeader(
  port: number,
  hostHeader: string,
  body: string,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: MCP_PATH_FOR_TEST,
        headers: {
          host: hostHeader,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${TOKEN}`,
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume(); // drain, we only need the status
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const MCP_PATH_FOR_TEST = '/mcp';

const INITIALIZE_BODY = {
  jsonrpc: '2.0' as const,
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-http-test-client', version: '0.0.0' },
  },
};

describeIfPg('startMcpHttpServer', () => {
  it('POST /mcp with no Authorization header is 401', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('POST /mcp with the WRONG bearer token is 401', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('POST /mcp with the correct bearer token and an initialize request returns a non-401 valid JSON-RPC frame', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(res.status).toBe(200);
    // The SDK's StreamableHTTP transport replies over SSE (`text/event-stream`)
    // by default rather than plain JSON — extract the JSON-RPC payload from
    // the `data:` line of the first SSE frame rather than assuming a bare
    // JSON body.
    const raw = await res.text();
    const dataLine = raw.split('\n').find((line) => line.startsWith('data: '));
    expect(dataLine).toBeDefined();
    const body = JSON.parse((dataLine as string).slice('data: '.length)) as {
      jsonrpc: string;
      id: number;
      result?: { serverInfo?: { name?: string } };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result?.serverInfo?.name).toBe('silo');
  });

  it('a valid DB access token (generated via core.generateAccessToken) is accepted as the bearer, even though it is not the configured env token', async () => {
    const core = await import('@silo/core');
    const created = await core.generateAccessToken('mcp-http-test db-token');

    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${created.token}`,
      },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(res.status).toBe(200);
  });

  it('a REVOKED DB access token is 401', async () => {
    const core = await import('@silo/core');
    const created = await core.generateAccessToken('mcp-http-test revoked-token');
    const revoked = await core.revokeAccessToken(created.id);
    expect(revoked).toBe(true);

    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${created.token}`,
      },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('GET /mcp (wrong method) is 404', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it('POST to an unknown path is 404, even with a valid token', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/not-mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('POST /mcp with the correct token but an invalid JSON body is 400', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('POST /mcp with the correct bearer but a foreign Host header is rejected (DNS-rebinding protection)', async () => {
    const { port } = await startTestServer();
    const { status } = await postWithHostHeader(
      port,
      'evil.example.com',
      JSON.stringify(INITIALIZE_BODY),
    );
    // The SDK's DNS-rebinding guard rejects a Host header outside
    // `allowedHosts` with a 4xx (its own error, not a plain 401/404) —
    // assert it is neither the success path nor left hanging/2xx.
    expect(status).not.toBe(200);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('POST /mcp with the correct bearer and the correct 127.0.0.1:<port> Host header still works', async () => {
    const { port } = await startTestServer();
    const { status } = await postWithHostHeader(
      port,
      `127.0.0.1:${port}`,
      JSON.stringify(INITIALIZE_BODY),
    );
    expect(status).toBe(200);
  });

  it('POST /mcp with a body larger than MAX_MCP_BODY_BYTES (4MB) is 413', async () => {
    const { baseUrl } = await startTestServer();
    // Doesn't need to be valid JSON-RPC — the size check fires before the
    // body is ever parsed.
    const oversized = 'x'.repeat(4 * 1024 * 1024 + 1024);
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: oversized,
    });
    expect(res.status).toBe(413);
  });

  it('POST /mcp with mcpAccess=false is 403 even with a valid token and Host', async () => {
    const core = await import('@silo/core');
    await core.setSetting('mcpAccess', false);

    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mcp_access_disabled' });
  });

  it('POST /mcp with mcpAccess=true (the default) still works — the happy path is unaffected by the gate', async () => {
    const core = await import('@silo/core');
    // Explicit, not relying purely on the fresh-DB default, since this suite
    // runs other tests that flip mcpAccess to false and reset it in
    // `afterEach` — this assertion documents the gate's "default on" contract
    // regardless of ordering.
    await core.setSetting('mcpAccess', true);

    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(res.status).toBe(200);
  });

  it('fails CLOSED (500, never the MCP handler) when the mcpAccess settings read throws', async () => {
    // Security-critical regression guard: `routeMcpRequest` awaits
    // `getSetting('mcpAccess')` with NO try/catch — a rejection (e.g. a
    // transient DB outage) propagates up to `startMcpHttpServer`'s top-level
    // `.catch`, which responds 500 and never reaches `handleMcpRequest`/the
    // MCP tool handler. This is intentional: a settings-read failure must
    // REFUSE the request, not silently default to "access allowed". A future
    // refactor that wraps `getSetting` in a try/catch defaulting to `true` on
    // error would flip this to fail-OPEN — this test exists to catch exactly
    // that regression.
    //
    // `vi.mock('@silo/core', { spy: true })` at the top of this file makes
    // every `@silo/core` export a real-passthrough spy, so `getSetting` here
    // is a `vi.fn` wrapping the real implementation — `mockRejectedValueOnce`
    // overrides just the next call's outcome without touching any other
    // export (`timingSafeEqual`, `setSetting`, etc. used by `afterEach` and
    // every other test stay real, against the real disposable DB).
    const core = await import('@silo/core');
    await core.setSetting('mcpAccess', true); // rule out "false" as the cause of a non-200
    vi.mocked(core.getSetting).mockRejectedValueOnce(new Error('db down (simulated)'));

    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(INITIALIZE_BODY),
    });

    // Fail closed: must be a server error, and specifically must NOT be a
    // 200 with a successful JSON-RPC result — that would mean the rejected
    // settings read was swallowed and the request reached the MCP handler.
    expect(res.status).toBe(500);
    expect(res.status).not.toBe(200);
    expect(await res.json()).toEqual({ error: 'internal_error' });
  });
});

describeIfPg('startMcpHttpServer — invalid port handling', () => {
  it('throws for a port outside the valid TCP range (documents that main.ts must guard before calling this)', async () => {
    const { startMcpHttpServer } = await import('./mcp-http.js');
    // `server.listen()` throws a synchronous RangeError for an out-of-range
    // port. `startMcpHttpServer` does not itself validate the port — the
    // range check lives in `main.ts` (see its `Number.isInteger(port) &&
    // port >= 1 && port <= 65535` guard) precisely so an invalid
    // `SILO_MCP_HTTP_PORT` never reaches this call. This test documents and
    // locks in that contract: calling this function directly with a bad
    // port still throws, so `main.ts`'s guard — not this function — is what
    // must prevent it in production.
    expect(() => startMcpHttpServer({ port: 70000, token: TOKEN, host: '127.0.0.1' })).toThrow();
  });
});
