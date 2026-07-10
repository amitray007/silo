import { startMcpHttpServer } from './mcp-http.js';

/**
 * `@silo/app`'s MCP-HTTP-only entrypoint (deployable-silo design, Unit 3
 * support) — the `mcp` container's process. Starts ONLY the networked HTTP
 * MCP listener: no worker, no stdio MCP. This is deliberately narrower than
 * `main.ts` (the turnkey process), which always starts `@silo/worker` before
 * anything else.
 *
 * Why a separate entrypoint rather than reusing `main.ts` with a flag: the
 * two-subdomain deploy topology (see the design doc) runs the worker
 * in-process inside the `api` container (Unit 2, `packages/api`). If the
 * `mcp` container ALSO ran `startWorker()` (as `main.ts` unconditionally
 * does), two worker instances would double-run the enrichment work loop AND
 * the scheduled cron jobs (purge-trash / sweep-enriching / dlq-alert) —
 * silent double-execution, not a crash, so it would go unnoticed until data
 * corruption or duplicate side effects surfaced. This process's only job is
 * the listener, so it never imports `@silo/worker` at all.
 *
 * Fail-fast, not fail-open: unlike `main.ts` (where a bad
 * `SILO_MCP_HTTP_PORT`/missing token degrades to "stdio MCP still works"),
 * this process has NOTHING to fall back to — a misconfigured mcp container
 * that logs and idles is worse than one that exits non-zero, since the
 * latter surfaces immediately in the orchestrator (Dokploy/compose restart
 * loop, failed healthcheck) instead of silently serving nothing.
 */

/** Parsed, validated config for the MCP-HTTP-only process. Exported so tests
 * can exercise the parsing/validation logic without booting a real listener
 * or touching `process.env`/`process.exit` — `readMcpHttpConfig` below is the
 * only piece of this file's boot sequence that has meaningful branching to
 * cover; the rest is process wiring. */
export type McpHttpConfig = {
  port: number;
  token: string;
  host: string;
  extraAllowedHosts: string[];
};

/** Discriminated result so the caller (both `main()` below and tests) can
 * distinguish "config is valid" from "config is invalid, here's why" without
 * throwing — this process's `main()` turns an `invalid` result into a loud
 * stderr message + `process.exit(1)`, but the parsing itself stays a pure,
 * testable function. */
export type McpHttpConfigResult =
  | { ok: true; config: McpHttpConfig }
  | { ok: false; reason: string };

/** Parses and validates the env surface this process needs, given an
 * env-like record (defaults to `process.env` — callers pass a plain object in
 * tests). Mirrors `main.ts`'s `SILO_MCP_HTTP_PORT` integer-range guard
 * (`Number.isInteger(port) && port >= 1 && port <= 65535`, `0` excluded as a
 * near-certain typo/blank-env case) so the two entrypoints apply an
 * IDENTICAL port contract — this process just fails hard instead of
 * degrading to stdio-only, since it has no stdio MCP to fall back to.
 *
 * `SILO_MCP_HTTP_HOST` (bind host) defaults to `'127.0.0.1'` — the same safe
 * loopback default `startMcpHttpServer` itself falls back to — so an operator
 * who forgets to set it locally still gets today's safe behavior; the
 * container sets it to `'0.0.0.0'` explicitly (see the design doc's env
 * surface table).
 *
 * `SILO_MCP_ALLOWED_HOSTS` (comma-separated) feeds `extraAllowedHosts` on
 * `startMcpHttpServer` verbatim (see that function's doc comment for why no
 * port is appended) — split on commas, trimmed, empty entries dropped, so a
 * trailing comma or accidental whitespace in the env value doesn't produce a
 * bogus empty-string allowed-host entry.
 */
export function readMcpHttpConfig(
  env: Record<string, string | undefined> = process.env,
): McpHttpConfigResult {
  const rawPort = env.SILO_MCP_HTTP_PORT;
  if (rawPort === undefined || rawPort.length === 0) {
    return {
      ok: false,
      reason: 'SILO_MCP_HTTP_PORT is not set — the mcp-http process has nothing to listen on.',
    };
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      reason: `SILO_MCP_HTTP_PORT is set to an invalid port (${rawPort}) — must be an integer in 1-65535.`,
    };
  }

  // Same "unset OR empty string means no token" semantics as core's
  // `readTokenEnv` (`packages/core/src/auth/token.ts`), reimplemented against
  // the injected `env` record rather than calling `readTokenEnv` directly:
  // that helper always reads the REAL `process.env` (by design — see its own
  // doc comment on why it isn't cached/injectable), which would make this
  // function silently ignore a test's `env` override for the token while
  // honoring it for every other var. Keeping the semantics identical (not the
  // function call) keeps this in lockstep with the other auth gates that use
  // `readTokenEnv` directly.
  const rawToken = env.SILO_API_TOKEN;
  const token = rawToken !== undefined && rawToken.length > 0 ? rawToken : undefined;
  if (token === undefined) {
    return {
      ok: false,
      reason:
        'SILO_API_TOKEN is not set — refusing to start an unauthenticated networked MCP endpoint.',
    };
  }

  const host =
    env.SILO_MCP_HTTP_HOST !== undefined && env.SILO_MCP_HTTP_HOST.length > 0
      ? env.SILO_MCP_HTTP_HOST
      : '127.0.0.1';

  const extraAllowedHosts = (env.SILO_MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return { ok: true, config: { port, token, host, extraAllowedHosts } };
}

async function main(): Promise<void> {
  const result = readMcpHttpConfig();
  if (!result.ok) {
    console.error(`[silo-mcp-http] ${result.reason}`);
    process.exit(1);
    return;
  }
  const { port, token, host, extraAllowedHosts } = result.config;

  const httpServer = startMcpHttpServer({ port, token, host, extraAllowedHosts });
  httpServer.once('error', (error: unknown) => {
    // A late async listen error (EADDRINUSE, EACCES on a privileged port,
    // etc.) — this process has no fallback surface, so treat it the same as
    // a boot-time config failure: log loudly and exit non-zero so the
    // container orchestrator restarts/surfaces it.
    console.error('[silo-mcp-http] listener error:', error);
    process.exit(1);
  });
  httpServer.once('listening', () => {
    // Read the bound address inside 'listening' (same reasoning as
    // `main.ts`): `listen()` is async, so reading `.address()` right after
    // the call would race ahead of the bind.
    const address = httpServer.address();
    const boundPort = typeof address === 'object' && address !== null ? address.port : port;
    console.error(`[silo-mcp-http] listening — http://${host}:${boundPort}/mcp`);
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.error(`[silo-mcp-http] received ${signal}, stopping gracefully...`);
    httpServer.close((closeError) => {
      if (closeError) {
        console.error('[silo-mcp-http] error closing listener:', closeError);
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only run `main()` when this file is executed directly (`tsx
// src/mcp-http-main.ts`), not when it's imported — `mcp-http-main.test.ts`
// imports `readMcpHttpConfig` from this module, and without this guard that
// import would ALSO trigger `main()`'s real boot sequence (and its
// `process.exit` calls) as a side effect, against whatever `process.env`
// happens to be in the test process. Same idiom as `@silo/worker`'s
// `worker.ts`.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error('[silo-mcp-http] fatal:', error);
    process.exit(1);
  });
}
