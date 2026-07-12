import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  authenticateOAuthToken,
  canonicalMcpResource,
  getSetting,
  timingSafeEqual,
  verifyAccessToken,
} from '@silo/core';
import { createSiloMcpServer } from '@silo/mcp-server';

const MCP_PATH = '/mcp';
const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** Wildcard CORS headers for the OAuth discovery surface only (protected-
 * resource metadata + its preflight). ChatGPT/Claude connector UIs fetch this
 * from a browser origin, so it must be reachable cross-origin — unlike
 * `POST /mcp` itself, which stays same-origin-only (no CORS headers added
 * there; the SDK transport doesn't need them for a server-to-server bearer
 * call). Mirrors the reference implementation's `CORS_HEADERS` shape. */
const DISCOVERY_CORS_HEADERS: http.OutgoingHttpHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: string,
  extraHeaders?: http.OutgoingHttpHeaders,
): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
  res.end(body);
}

/**
 * `WWW-Authenticate` now carries a `resource_metadata` pointer (RFC 9728) at
 * the mcp origin, so an OAuth-aware client (Claude/ChatGPT connector UI) that
 * gets a bare 401 can discover where to start the authorization flow — see
 * `resourceMetadataUrl`. The response BODY stays the unchanged,
 * uninformative `UNAUTHORIZED_BODY`: the header carries a public,
 * non-secret URL (fine to leak to a prober), but the body must never
 * distinguish failure reasons (no auth oracle).
 */
function sendUnauthorized(res: http.ServerResponse, resourceMetadataUrl: string): void {
  if (res.headersSent) return;
  res.writeHead(401, {
    'content-type': 'application/json',
    'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
  });
  res.end(UNAUTHORIZED_BODY);
}

/**
 * Derives the mcp origin (scheme + host, no path) that
 * `/.well-known/oauth-protected-resource` is hosted at, from whatever
 * `publicMcpUrl` resolves to (either the operator's `SILO_PUBLIC_MCP_URL` or
 * the local-dev fallback — see `resolvePublicUrls`). `canonicalMcpResource`
 * normalizes to a `/mcp`-suffixed URL; stripping that known suffix (rather
 * than a generic `new URL(...).origin`) preserves a non-root path prefix if
 * an operator ever puts the listener behind one, and avoids constructing a
 * second URL-parsing path for what's already a well-known shape.
 */
function mcpOrigin(canonicalResource: string): string {
  return canonicalResource.endsWith('/mcp')
    ? canonicalResource.slice(0, -'/mcp'.length)
    : canonicalResource;
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
 *
 * `opts.extraAllowedHosts` (deployable-silo design, Unit 3 support) extends
 * `allowedHosts()` with caller-supplied entries added VERBATIM — no `:port`
 * suffix appended. This is for the reverse-proxy case: behind Traefik the
 * container binds an internal port (e.g. 8788) but the incoming `Host`
 * header is the PUBLIC hostname with no port at all (`mcp.silo.example.com`,
 * since the browser/agent connects to :443 and Traefik forwards over the
 * internal network) — the `{host}:{boundPort}` entry this function otherwise
 * derives would never match a proxied request's Host header. Undefined/empty
 * is a no-op, so existing callers (and `main.ts`'s stdio-first entrypoint)
 * are unaffected.
 *
 * `opts.publicMcpUrl`/`opts.publicApiUrl` (MCP OAuth slice, Unit 3) feed the
 * RFC 8707 canonical resource + RFC 9728 protected-resource metadata. Both
 * are optional: when unset (local dev, or a test that doesn't care about
 * OAuth), `resolvePublicUrls` derives a same-process fallback from
 * `host`/`port` so `/.well-known/oauth-protected-resource` and the
 * `WWW-Authenticate` header are always well-formed, and `oat_` tokens can
 * still be exercised in tests without prod env.
 */
export function startMcpHttpServer(opts: {
  port: number;
  token: string;
  host?: string;
  extraAllowedHosts?: string[];
  publicMcpUrl?: string | undefined;
  publicApiUrl?: string | undefined;
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
    for (const extra of opts.extraAllowedHosts ?? []) {
      hosts.add(extra);
    }
    return [...hosts];
  }

  // Same lazy-`server.address()` reasoning as `allowedHosts()`: `opts.port`
  // may be `0` (ephemeral, e.g. tests), so the local-dev fallback must read
  // the REAL bound port, not the requested one. `publicMcpUrl`/`publicApiUrl`
  // are resolved once per request (cheap string ops, no I/O) rather than
  // cached at server-start, so an ephemeral port that isn't bound yet at
  // `startMcpHttpServer`-call-time is still correct once `listen()` completes.
  function resolvePublicUrls(): { canonicalResource: string; authorizationServer: string } {
    const address = server.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : opts.port;
    const fallbackOrigin = `http://127.0.0.1:${boundPort}`;
    const canonicalResource = canonicalMcpResource(opts.publicMcpUrl ?? `${fallbackOrigin}/mcp`);
    const authorizationServer = opts.publicApiUrl ?? fallbackOrigin;
    return { canonicalResource, authorizationServer };
  }

  const server = http.createServer((req, res) => {
    routeMcpRequest(req, res, opts.token, allowedHosts, resolvePublicUrls).catch(
      (error: unknown) => {
        console.error('[silo] mcp-http request handler error:', error);
        sendJson(res, 500, JSON.stringify({ error: 'internal_error' }));
      },
    );
  });

  server.listen(opts.port, host);
  return server;
}

/** `GET /.well-known/oauth-protected-resource` (RFC 9728) + its OPTIONS
 * preflight — split out of `routeMcpRequest` purely to keep that function's
 * own branching under the complexity ceiling, same rationale as
 * `handleMcpRequest`. Always wildcard-CORS'd (see `DISCOVERY_CORS_HEADERS`'s
 * doc comment); GET returns the metadata JSON, OPTIONS a bare 204. */
function handleProtectedResourceMetadata(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  resolvePublicUrls: () => { canonicalResource: string; authorizationServer: string },
): void {
  if (req.method === 'OPTIONS') {
    if (res.headersSent) return;
    res.writeHead(204, DISCOVERY_CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 404, JSON.stringify({ error: 'not_found' }));
    return;
  }
  const { canonicalResource, authorizationServer } = resolvePublicUrls();
  sendJson(
    res,
    200,
    JSON.stringify({
      resource: canonicalResource,
      authorization_servers: [authorizationServer],
      scopes_supported: ['silo'],
      bearer_methods_supported: ['header'],
    }),
    DISCOVERY_CORS_HEADERS,
  );
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
  resolvePublicUrls: () => { canonicalResource: string; authorizationServer: string },
): Promise<void> {
  const url = req.url ? new URL(req.url, 'http://localhost').pathname : undefined;

  if (url === PROTECTED_RESOURCE_PATH) {
    handleProtectedResourceMetadata(req, res, resolvePublicUrls);
    return;
  }

  if (req.method !== 'POST' || url !== MCP_PATH) {
    sendJson(res, 404, JSON.stringify({ error: 'not_found' }));
    return;
  }

  const { canonicalResource } = resolvePublicUrls();
  const resourceMetadataUrl = `${mcpOrigin(canonicalResource)}${PROTECTED_RESOURCE_PATH}`;

  // Auth FIRST — before touching the body — so an unauthenticated caller
  // never causes the (more expensive) body-read/MCP-wiring path to run.
  //
  // Three ways to authenticate, tried cheapest/most-common first — ANY one
  // passing is sufficient:
  //   1. env token (`SILO_API_TOKEN`, timing-safe compare, synchronous).
  //   2. legacy DB-backed access token (`kind='bearer'`, `verifyAccessToken`
  //      — access-tokens slice, U2), mirroring `general-auth.ts`'s
  //      env-first-then-DB-fallback ordering.
  //   3. an `oat_` OAuth access token (MCP OAuth slice, Unit 3),
  //      audience-checked against THIS listener's own canonical resource via
  //      `authenticateOAuthToken` — a token minted for a different resource
  //      fails here even if otherwise valid (RFC 8707).
  // Each check only runs if the previous ones failed (`!envOk &&` / `!envOk
  // && !dbOk &&` short-circuits), so the common case (correct env token)
  // never pays for either async DB round-trip.
  const requestToken = bearerToken(req);
  const envOk = requestToken !== undefined && timingSafeEqual(requestToken, token);
  const dbOk = !envOk && requestToken !== undefined && (await verifyAccessToken(requestToken));
  const oauthOk =
    !envOk &&
    !dbOk &&
    requestToken !== undefined &&
    (await authenticateOAuthToken(requestToken, canonicalResource));
  if (!envOk && !dbOk && !oauthOk) {
    sendUnauthorized(res, resourceMetadataUrl);
    return;
  }

  // Per-request gate: the operator can disable the networked HTTP MCP surface
  // from Settings (core `mcpAccess`, default true) WITHOUT restarting the
  // server or unsetting SILO_MCP_HTTP_PORT. When off, a fully-authenticated
  // request (valid token + allowed Host) is still refused. The stdio MCP path
  // is unaffected — this gate is specific to the networked surface.
  const mcpAccessEnabled = await getSetting('mcpAccess');
  if (!mcpAccessEnabled) {
    sendJson(res, 403, JSON.stringify({ error: 'mcp_access_disabled' }));
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
