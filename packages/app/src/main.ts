import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSiloMcpServer } from '@silo/mcp-server';
import { startWorker } from '@silo/worker';

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
          process.exit(0);
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
