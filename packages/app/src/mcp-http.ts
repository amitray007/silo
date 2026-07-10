import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from '@silo/core';
import { createSiloMcpServer } from '@silo/mcp-server';

const MCP_PATH = '/mcp';

/** Cap on the buffered request body (matches the SDK's own Express body-parser
 * default of 4mb — see `StreamableHTTPServerTransport`'s docs). An
 * authenticated caller could otherwise send an unbounded body and OOM this
 * process, which also kills the co-located worker (see `readJsonBody`). */
const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;

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

/** Thrown internally when a request body exceeds `MAX_MCP_BODY_BYTES` — a
 * dedicated error type lets the caller distinguish "too large" (413) from
 * "malformed JSON" (400) without inspecting error messages. */
class PayloadTooLargeError extends Error {
  constructor() {
    super('request body exceeds MAX_MCP_BODY_BYTES');
    this.name = 'PayloadTooLargeError';
  }
}

/** Buffers the full request body and JSON-parses it. Rejects (rather than
 * throwing synchronously) on a parse failure so the caller can respond with
 * a 400 instead of crashing the request handler. Enforces
 * `MAX_MCP_BODY_BYTES`: an authenticated caller could otherwise stream an
 * unbounded body and OOM this process (which also kills the co-located
 * worker) — the size check runs in the `data` handler, before chunks
 * accumulate further.
 *
 * On overflow this deliberately does NOT `req.destroy()` the socket: an
 * abrupt destroy resets the TCP connection out from under a client that's
 * still mid-write of the (oversized) body, so most HTTP clients — including
 * `fetch`/undici — see a raw socket error instead of the intended 413
 * response. Instead it `pause()`s the stream (stops consuming further
 * chunks, applying backpressure) and rejects immediately, letting the
 * handler write a clean 413 and end the response; the still-buffered/
 * incoming request body is drained and discarded once the response socket
 * closes. */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_MCP_BODY_BYTES) {
        rejected = true;
        req.pause();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('invalid JSON body'));
      }
    });
    req.on('error', (error: Error) => {
      if (rejected) return;
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

  // DNS-rebinding protection (fix P1): the SDK defaults
  // `enableDnsRebindingProtection` to false, which skips validating the
  // request's `Host` header — a malicious website can DNS-rebind an
  // attacker-controlled hostname to 127.0.0.1 and reach this loopback-bound
  // listener from a browser context. Scope `allowedHosts` to the bound
  // host:port so only requests whose `Host` header names this exact listener
  // are accepted; the SDK rejects anything else with a 403-class error.
  //
  // Computed lazily from `server.address()` rather than `opts.port` directly:
  // `opts.port` may be `0` (OS-assigns an ephemeral port, e.g. in tests), in
  // which case the *requested* port is never the port clients actually
  // connect to — only the real bound port (read once the server is
  // listening) matches the `Host` header a client sends.
  function allowedHosts(): string[] {
    const address = server.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : opts.port;
    const hosts = new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      hosts.add(`${host}:${boundPort}`);
    }
    return [...hosts];
  }

  const server = http.createServer((req, res) => {
    routeMcpRequest(req, res, opts.token, allowedHosts).catch((error: unknown) => {
      console.error('[silo] mcp-http request handler error:', error);
      sendJson(res, 500, JSON.stringify({ error: 'internal_error' }));
    });
  });

  server.listen(opts.port, host);
  return server;
}

/** Method/path/auth/body gating for a single request, split out of
 * `startMcpHttpServer` so its branching is scored independently of that
 * function's `allowedHosts()` closure — kept below the lint-enforced
 * cognitive-complexity ceiling as its own concern (request gating vs.
 * transport wiring, the latter lives in `handleMcpRequest`). */
async function routeMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  computeAllowedHosts: () => string[],
): Promise<void> {
  const url = req.url ? new URL(req.url, 'http://localhost').pathname : undefined;

  if (req.method !== 'POST' || url !== MCP_PATH) {
    sendJson(res, 404, JSON.stringify({ error: 'not_found' }));
    return;
  }

  // Auth FIRST — before touching the body — so an unauthenticated caller
  // never causes the (more expensive) body-read/MCP-wiring path to run.
  const requestToken = bearerToken(req);
  if (requestToken === undefined || !timingSafeEqual(requestToken, token)) {
    sendUnauthorized(res);
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(req);
  } catch (error: unknown) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(res, 413, JSON.stringify({ error: 'payload_too_large' }));
    } else {
      sendJson(res, 400, JSON.stringify({ error: 'invalid_json' }));
    }
    return;
  }

  await handleMcpRequest(req, res, parsedBody, computeAllowedHosts());
}

/** Wires a fresh `createSiloMcpServer()` + `StreamableHTTPServerTransport` for
 * ONE request (see `startMcpHttpServer`'s doc comment for the stateless-mode
 * rationale) and hands the request off to it. Split out of the request
 * handler purely to keep that handler's branching (method/path/auth/body
 * checks) below the lint-enforced cognitive-complexity ceiling — this
 * function's own job (transport setup + cleanup wiring) is a separate
 * concern from the request-gating logic above it. */
async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parsedBody: unknown,
  allowedHosts: string[],
): Promise<void> {
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
  // weakening our own tsconfig. `enableDnsRebindingProtection`/`allowedHosts`
  // are real, documented SDK 1.29.0 options (`WebStandardStreamableHTTPServerTransportOptions`)
  // — they ride the same cast for the same `exactOptionalPropertyTypes` reason,
  // not because they're untyped.
  const transportOptions = {
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts,
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
}
