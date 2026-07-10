import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readTokenEnv } from '@silo/core';
import { createSiloMcpServer } from '@silo/mcp-server';
import { startWorker } from '@silo/worker';
import { startMcpHttpServer } from './mcp-http.js';

/**
 * `@silo/app` — the turnkey `silo` process (plan 005, A2).
 *
 * Composes TWO subsystems that used to require two separate OS processes:
 * the enrichment worker (`@silo/worker`) and the stdio MCP tool server
 * (`@silo/mcp-server`). Running them together in one process closes the gap
 * gate-2 QA found: an MCP-only process never calls `setEnrichmentEnqueuer`,
 * so `capture_link` saves a row but nothing ever enqueues it — links strand
 * at `enriching` forever. `@silo/worker`'s `startWorker()` is what flips that
 * seam (see its doc comment), so it MUST run, and MUST finish registering the
 * enqueuer, before the MCP server can accept its first `capture_link` call.
 *
 * Order matters:
 *   1. `startWorker()` — connects pg-boss, ensures the queue, registers the
 *      enqueuer (core's process-local seam goes live in THIS process), and
 *      starts the enrichment work loop.
 *   2. `createSiloMcpServer()` + connect over stdio — only after the seam is
 *      live, so no capture can race ahead of it.
 *
 * All diagnostics go to stderr — stdout is the MCP JSON-RPC channel once the
 * transport connects, and a stray stdout write would corrupt the protocol.
 */
async function main(): Promise<void> {
  const worker = await startWorker();
  console.error('[silo] worker started (enqueuer registered, enrichment loop running)');

  const server = createSiloMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[silo] mcp server connected over stdio — turnkey process ready');

  // Optional networked MCP surface (MCP-HTTP slice, U2): unset by default, so
  // the turnkey process stays stdio-only unless an operator explicitly opts
  // in. ALWAYS-CLOSED: even with the port set, the listener refuses to start
  // without SILO_API_TOKEN — a networked MCP endpoint must never be
  // reachable unauthenticated (same posture as `/api/ingest`).
  let httpServer: ReturnType<typeof startMcpHttpServer> | undefined;
  const mcpHttpPort = process.env.SILO_MCP_HTTP_PORT;
  if (mcpHttpPort !== undefined && mcpHttpPort.length > 0) {
    const port = Number(mcpHttpPort);
    // Tightened guard (fix CORR-1): `Number.isFinite` alone lets through
    // out-of-range (70000), negative (-1), fractional (3.14), and
    // whitespace/blank-coerced-to-0 values. Any of those would previously
    // reach `server.listen(port)`, which throws a SYNCHRONOUS `RangeError`
    // for out-of-range ports — uncaught, that propagates to `main().catch`
    // and calls `process.exit(1)`, killing the already-running worker + stdio
    // MCP over a networked-listener misconfig. Require a true integer in the
    // valid TCP port range; `0` (OS-ephemeral) is deliberately excluded here
    // — it's a near-certain typo/blank-env case for an operator-set env var
    // (the ephemeral-port use case is exercised by calling
    // `startMcpHttpServer` directly, e.g. in tests, bypassing this guard).
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(
        `[silo] SILO_MCP_HTTP_PORT is set to an invalid port (${mcpHttpPort}) — refusing to ` +
          'start the HTTP MCP listener. stdio MCP still works.',
      );
    } else {
      const token = readTokenEnv('SILO_API_TOKEN');
      if (token === undefined) {
        console.error(
          '[silo] SILO_MCP_HTTP_PORT is set but SILO_API_TOKEN is not — refusing to start an ' +
            'unauthenticated networked MCP endpoint. stdio MCP still works.',
        );
      } else {
        // Defensive wrap (fix CORR-1b): `startMcpHttpServer`/`server.listen`
        // can still throw or emit a late async 'error' (e.g. EADDRINUSE,
        // EACCES on a privileged port) even with a range-valid port. Never
        // let that reach `main().catch` — log loudly and continue with
        // stdio-only, same posture as the guards above.
        try {
          httpServer = startMcpHttpServer({ port, token });
          httpServer.once('error', (error: unknown) => {
            console.error('[silo] mcp http listener error:', error);
          });
          // Read the bound address inside 'listening' (fix CORR-2): `listen()`
          // is async, so reading `.address()` synchronously right after the
          // call (the old code) always raced ahead of the bind and returned
          // null — the log then printed the REQUESTED port, which is
          // actively wrong for an ephemeral bind (`:0`). Deferring the log
          // into the 'listening' callback guarantees `.address()` is
          // populated with the actually-bound port.
          httpServer.once('listening', () => {
            const address = httpServer?.address();
            const boundPort = typeof address === 'object' && address !== null ? address.port : port;
            console.error(`[silo] mcp http listener bound — http://127.0.0.1:${boundPort}/mcp`);
          });
        } catch (error: unknown) {
          console.error(
            '[silo] failed to start the HTTP MCP listener — stdio MCP still works:',
            error,
          );
          httpServer = undefined;
        }
      }
    }
  }

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.error(`[silo] received ${signal}, stopping gracefully...`);
    (async () => {
      try {
        await worker.stop();
      } catch (error: unknown) {
        console.error('[silo] error stopping worker:', error);
      } finally {
        try {
          await server.close();
        } catch (error: unknown) {
          console.error('[silo] error closing mcp server:', error);
        } finally {
          if (httpServer === undefined) {
            process.exit(0);
          } else {
            httpServer.close((closeError) => {
              if (closeError) {
                console.error('[silo] error closing mcp http listener:', closeError);
              }
              process.exit(0);
            });
          }
        }
      }
    })().catch((error: unknown) => {
      // Belt-and-suspenders: the inner try/finally already handles every
      // rejection path above, but a shutdown routine must never leave the
      // process hanging if something still slips through.
      console.error('[silo] unexpected error during shutdown:', error);
      process.exit(1);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error('[silo] fatal:', error);
  process.exit(1);
});
