import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from '@silo/core';
import { createSiloMcpServer } from '@silo/mcp-server';

const MCP_PATH = '/mcp';

/** Generic 401 body — deliberately uninformative. Distinguishing "no header"
 * from "wrong token" (or confirming a token is configured at all) would leak
 * auth-oracle information to a prober; both cases return the exact same
 * shape and status. */
const UNAUTHORIZED_BODY = JSON.stringify({
  jsonrpc: '2.0',
  error: { code: -32001, message: 'Unauthorized' },
  id: null,
});

function sendJson(res: http.ServerResponse, status: number, body: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

function sendUnauthorized(res: http.ServerResponse): void {
  if (res.headersSent) return;
  res.writeHead(401, {
    'content-type': 'application/json',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(UNAUTHORIZED_BODY);
}

/** Parses `Authorization: Bearer <token>`, returning the token or `undefined`
 * if the header is absent or not in the exact `Bearer <token>` form. Node's
 * `IncomingMessage.headers` lookup is already lowercased/normalized by the
 * `http` module, so a single lowercase-key read matches any casing the
 * client sent. */
function bearerToken(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}

/** Buffers the full request body and JSON-parses it. Rejects (rather than
 * throwing synchronously) on a parse failure so the caller can respond with
 * a 400 instead of crashing the request handler. */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('invalid JSON body'));
      }
    });
    req.on('error', (error: Error) => {
      reject(error);
    });
  });
}

/**
 * Starts a token-gated HTTP MCP listener — the networked counterpart to
 * `main.ts`'s stdio MCP server (MCP-HTTP slice, U2). Opt-in and always-closed:
 * only `main.ts` decides whether to call this (never unconditionally), and it
 * only does so once a token is confirmed present (see its own doc comment).
 *
 * Per-request lifecycle (stateless mode): each POST /mcp gets a FRESH
 * `createSiloMcpServer()` + a FRESH `StreamableHTTPServerTransport({
 * sessionIdGenerator: undefined })`, connected just for that request. This is
 * the SDK's documented stateless pattern — reusing one transport/server
 * across concurrent requests risks request-id/state collisions, since the
 * transport tracks in-flight request state internally. Both are torn down
 * when the response finishes (success or client-abort), so a slow or
 * abandoned request never leaks a server/transport pair.
 *
 * Binds to `opts.host ?? '127.0.0.1'` (loopback) by default — a networked MCP
 * surface must not be reachable off-host unless an operator explicitly opts
 * in via `host`.
 */
export function startMcpHttpServer(opts: {
  port: number;
  token: string;
  host?: string;
}): http.Server {
  const host = opts.host ?? '127.0.0.1';

  const server = http.createServer((req, res) => {
    (async () => {
      const url = req.url ? new URL(req.url, 'http://localhost').pathname : undefined;

      if (req.method !== 'POST' || url !== MCP_PATH) {
        sendJson(res, 404, JSON.stringify({ error: 'not_found' }));
        return;
      }

      // Auth FIRST — before touching the body — so an unauthenticated caller
      // never causes the (more expensive) body-read/MCP-wiring path to run.
      const token = bearerToken(req);
      if (token === undefined || !timingSafeEqual(token, opts.token)) {
        sendUnauthorized(res);
        return;
      }

      let parsedBody: unknown;
      try {
        parsedBody = await readJsonBody(req);
      } catch {
        sendJson(res, 400, JSON.stringify({ error: 'invalid_json' }));
        return;
      }

      const mcpServer = createSiloMcpServer();
      // The SDK's own stateless-mode example (streamableHttp.d.ts doc comment)
      // is `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`,
      // but its declared option type is `sessionIdGenerator?: () => string`
      // (no `| undefined` in the value type), and separately its `onclose`/
      // `onerror`/`onmessage` setters are typed `(() => void) | undefined`
      // against a `Transport` interface that declares them as plain optional
      // (`onclose?: () => void`) — both mismatches only surface under this
      // repo's `exactOptionalPropertyTypes`, which the SDK itself isn't built
      // with. Narrow, `unknown`-routed casts at this SDK boundary rather than
      // weakening our own tsconfig.
      const transportOptions = {
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0];
      const transport = new StreamableHTTPServerTransport(transportOptions);

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        transport.close().catch((error: unknown) => {
          console.error('[silo] error closing mcp-http transport:', error);
        });
        mcpServer.close().catch((error: unknown) => {
          console.error('[silo] error closing mcp-http server instance:', error);
        });
      };
      res.on('close', cleanup);
      res.on('finish', cleanup);

      await mcpServer.connect(transport as unknown as Parameters<typeof mcpServer.connect>[0]);
      await transport.handleRequest(req, res, parsedBody);
    })().catch((error: unknown) => {
      console.error('[silo] mcp-http request handler error:', error);
      sendJson(res, 500, JSON.stringify({ error: 'internal_error' }));
    });
  });

  server.listen(opts.port, host);
  return server;
}
