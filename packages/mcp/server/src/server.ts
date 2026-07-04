import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetLink } from './tools/get-link.js';
import { registerListLinks } from './tools/list-links.js';
import { registerSearchLinks } from './tools/search-links.js';

/**
 * Build the silo MCP server. Read tools (`get_link`, `search_links`,
 * `list_links`) are registered here — each a thin translation over an
 * `@silo/core` function (`architecture.md`: adapters do `MCP tool params ↔
 * core call ↔ MCP result`, never business logic).
 *
 * Returned unconnected so tests can construct it without a live transport, and
 * so `main.ts` owns the stdio wiring + process lifecycle.
 */
export function createSiloMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'silo', version: '0.0.0' },
    {
      instructions:
        'Silo is a personal link store. These tools read links you have ' +
        'captured (metadata, extracted text, tags). All intelligence — ' +
        'search strategy, synthesis, recommendations — is yours to perform ' +
        'over these read primitives; silo only holds the data.',
    },
  );

  // C3 registers get_link — the high-level McpServer only wires the
  // `tools/list` handler once the first tool is registered, so this call also
  // makes `tools/list` live for the first time.
  registerGetLink(server);
  // C4 registers search_links.
  registerSearchLinks(server);
  // C5 registers list_links.
  registerListLinks(server);

  return server;
}
