import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Build the silo MCP server. This is where read tools (`get_link`,
 * `search_links`, `list_links`) are registered in later units — each a thin
 * translation over an `@silo/core` function (`architecture.md`: adapters do
 * `MCP tool params ↔ core call ↔ MCP result`, never business logic). Right now
 * it registers ZERO tools: this unit only proves the server builds, connects
 * over stdio, and obeys the import boundary (core-only).
 *
 * Returned unconnected so tests can construct it without a live transport, and
 * so `main.ts` owns the stdio wiring + process lifecycle.
 */
export function createSiloMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'silo', version: '0.0.0' },
    {
      // NOTE: the high-level McpServer only wires the `tools/list` handler once
      // the first tool is registered (via registerTool). Until C3 adds a tool,
      // `tools/list` is intentionally unsupported — this scaffold only proves the
      // server builds + connects over stdio. The capability appears with C3.
      instructions:
        'Silo is a personal link store. These tools read links you have ' +
        'captured (metadata, extracted text, tags). All intelligence — ' +
        'search strategy, synthesis, recommendations — is yours to perform ' +
        'over these read primitives; silo only holds the data.',
    },
  );

  // Tools are registered in C3–C5. Intentionally none yet.

  return server;
}
