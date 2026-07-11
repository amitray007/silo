import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSiloMcpServer } from './server.js';

/**
 * stdio entrypoint (`silo-mcp` / `pnpm --filter @silo/mcp-server start`). An MCP
 * client (e.g. Claude Desktop/Code) launches this as a subprocess and speaks
 * JSON-RPC over stdin/stdout — so the OS process boundary is the trust boundary
 * (no network surface, no auth to implement). NOTHING may be written to stdout
 * except the transport's protocol frames; all diagnostics go to stderr.
 */
async function main(): Promise<void> {
  const server = createSiloMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // `connect` resolves once wired; the process stays alive on the stdio streams
  // until the client closes them. Log to stderr only.
  console.error('[silo/mcp] server connected over stdio');
}

main().catch((error) => {
  console.error('[silo/mcp] fatal:', error);
  process.exit(1);
});
