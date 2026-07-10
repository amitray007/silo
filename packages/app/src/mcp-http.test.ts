import type { Server } from 'node:http';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Tests for the token-gated HTTP MCP listener (MCP-HTTP slice, U2). Drives
 * real HTTP requests (via `fetch`) against an ephemeral-port instance —
 * `startMcpHttpServer` transitively imports `@silo/mcp-server` -> `@silo/core`
 * -> `@silo/db`, whose `db`/`pool` singleton reads `DATABASE_URL` at
 * module-load time (pg.Pool connects lazily, so a syntactically valid
 * placeholder is enough — same pattern as `mcp-server`'s own
 * `server.test.ts`). Kept lean: only the auth gate + a tool-less
 * `initialize` handshake are exercised, so no real Postgres connection is
 * ever opened.
 */
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

const TOKEN = 'mcp-http-test-token-do-not-use-in-prod';

let server: Server | undefined;

afterEach(async () => {
  if (server === undefined) return;
  const toClose = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    toClose.close((error) => (error ? reject(error) : resolve()));
  });
});

async function startTestServer(): Promise<{ baseUrl: string }> {
  const { startMcpHttpServer } = await import('./mcp-http.js');
  server = startMcpHttpServer({ port: 0, token: TOKEN, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected an ephemeral TCP address');
  }
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

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

describe('startMcpHttpServer', () => {
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
});
