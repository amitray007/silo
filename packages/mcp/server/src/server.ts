import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAddTag } from './tools/add-tag.js';
import { registerCaptureLink } from './tools/capture-link.js';
import { registerEditLink } from './tools/edit-link.js';
import { registerExportLinks } from './tools/export-links.js';
import { registerFindRelated } from './tools/find-related.js';
import { registerGetLink } from './tools/get-link.js';
import { registerListLinks } from './tools/list-links.js';
import { registerRemoveTag } from './tools/remove-tag.js';
import { registerRestoreLink } from './tools/restore-link.js';
import { registerRetryCapture } from './tools/retry-capture.js';
import { registerSearchLinks } from './tools/search-links.js';
import { registerTrashLink } from './tools/trash-link.js';

/**
 * Build the silo MCP server. Read tools (`get_link`, `search_links`,
 * `list_links`) and write tools (`capture_link`, ...) are registered here —
 * each a thin translation over an `@silo/core` function (`architecture.md`:
 * adapters do `MCP tool params ↔ core call ↔ MCP result`, never business
 * logic).
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
        'captured (metadata, extracted text, tags) and let you capture new ' +
        'ones. All intelligence — search strategy, synthesis, ' +
        'recommendations, deciding what to capture/tag — is yours to ' +
        'perform over these primitives; silo only holds the data.',
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
  // W2 registers capture_link — the first write tool.
  registerCaptureLink(server);
  // W3 registers edit_link, add_tag, and remove_tag.
  registerEditLink(server);
  registerAddTag(server);
  registerRemoveTag(server);
  // W4 registers trash_link and restore_link.
  registerTrashLink(server);
  registerRestoreLink(server);
  // W5 registers retry_capture — closes the agent-native parity gap for
  // retrying a degraded capture.
  registerRetryCapture(server);
  // Export slice U3 registers export_links — a full-library snapshot
  // (json/yaml/csv) for backup or bulk agent ingestion.
  registerExportLinks(server);
  // Agent-navigation slice U4 registers find_related — the one genuinely
  // new tool this slice adds ("more like this", seeded from a link's own
  // tags/title terms rather than agent-supplied words). Every other change
  // in this slice enriches an EXISTING tool's input/output instead of
  // adding a new one (see docs/superpowers/specs/2026-07-12-richer-query-
  // filters-design.md's guiding constraint).
  registerFindRelated(server);

  return server;
}
