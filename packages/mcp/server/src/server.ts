import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type AnySchema,
  objectFromShape,
  type ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import {
  ListToolsRequestSchema,
  type ListToolsResult,
  type ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { librarianMcpPersona } from '@silo/core';
import { registerAddLinkTag } from './tools/add-link-tag.js';
import { registerCaptureLink } from './tools/capture-link.js';
import { registerCreateTag } from './tools/create-tag.js';
import { registerDeleteTag } from './tools/delete-tag.js';
import { registerEditLink } from './tools/edit-link.js';
import { registerExportLinks } from './tools/export-links.js';
import { registerFeedTools } from './tools/feeds.js';
import { registerFindRelated } from './tools/find-related.js';
import { registerGetLink } from './tools/get-link.js';
import { registerHardDeleteLink } from './tools/hard-delete-link.js';
import { registerHighlightTools } from './tools/highlights.js';
import { registerListHighlights } from './tools/list-highlights.js';
import { registerListLinks } from './tools/list-links.js';
import { registerListReadingPositions } from './tools/list-reading-positions.js';
import { registerListTags } from './tools/list-tags.js';
import { registerListTrash } from './tools/list-trash.js';
import { registerRefreshReader } from './tools/refresh-reader.js';
import { registerRemoveLinkTag } from './tools/remove-link-tag.js';
import { registerRenameTools } from './tools/rename.js';
import { registerRestoreLink } from './tools/restore-link.js';
import { registerRetryCapture } from './tools/retry-capture.js';
import { registerSearchLinks } from './tools/search-links.js';
import { registerTrashLink } from './tools/trash-link.js';

type SchemaArg = ZodRawShapeCompat | AnySchema;
type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: SchemaArg;
  outputSchema?: SchemaArg;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};
type ToolRegistration = Readonly<{
  name: string;
  config: ToolConfig;
  cb: ToolCallback<SchemaArg | undefined>;
}>;

const SERVER_INFO = { name: 'silo', version: '0.0.0' } as const;
const SERVER_INSTRUCTIONS =
  'Silo is a personal link store. These tools read links you have ' +
  'captured (metadata, extracted text, tags) and let you capture new ' +
  'ones. All intelligence — search strategy, synthesis, ' +
  'recommendations, deciding what to capture/tag — is yours to ' +
  'perform over these primitives; silo only holds the data. ' +
  'list_links/search_links exclude feed posts; feed tools list and triage them, and save_feed_post copies a post to the library. ' +
  'get_link and refresh_reader also accept feed post ids. ' +
  'Use retry_capture fields for fast targeted re-enrichment; leave fields out for a full run.';

/**
 * Registers every tool, in the order `tools/list` reports them, on `server`.
 * Only ever called against the recorder in `toolRegistrations` — never a live
 * `McpServer` — so each tool's Zod schemas are built exactly once per process.
 */
export function registerAllTools(server: McpServer): void {
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
  // W3 registers edit_link, add_link_tag, and remove_link_tag.
  registerEditLink(server);
  registerAddLinkTag(server);
  registerRemoveLinkTag(server);
  registerDeleteTag(server);
  // Tag-tools slice registers create_tag — makes a standalone (empty) tag,
  // agent-native parity with the web '+ New tag' action / POST /api/tags.
  registerCreateTag(server);
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

  registerHardDeleteLink(server);
  // Reader tools slice 3a: passage highlights with notes.
  registerHighlightTools(server);
  registerListHighlights(server);
  registerListReadingPositions(server);

  registerListTags(server);

  registerListTrash(server);

  registerRefreshReader(server);
  registerFeedTools(server);
  registerRenameTools(server);
}

/** Zod raw shape (`{ id: z.uuid() }`) or ready schema; mirrors the SDK's own test. */
function isRawShape(schema: object): boolean {
  return !('_def' in schema) && !('_zod' in schema) && !('safeParse' in schema);
}

/**
 * What `McpServer.registerTool` does to a raw shape (`getZodSchemaObject`),
 * done once here so the per-request server receives ready Zod objects and
 * stores them as-is. Same SDK function, so validation and the generated JSON
 * Schema are unchanged.
 */
function prebuild(schema: SchemaArg): SchemaArg {
  return isRawShape(schema) ? objectFromShape(schema as ZodRawShapeCompat) : schema;
}

let registrations: readonly ToolRegistration[] | undefined;

/**
 * The tool definitions (names, configs with prebuilt Zod schemas, handlers),
 * built once per process. The `register*` functions are driven against a
 * recorder instead of a live server: they only call `registerTool`, and no
 * handler closes over the server or any per-request state (they call
 * module-level `@silo/core` functions), so one set of definitions is safe to
 * share across every server instance.
 */
function toolRegistrations(): readonly ToolRegistration[] {
  if (registrations) return registrations;
  const recorded: ToolRegistration[] = [];
  const recorder = {
    registerTool(name: string, config: ToolRegistration['config'], cb: ToolRegistration['cb']) {
      recorded.push({
        name,
        config: {
          ...config,
          ...(config.inputSchema ? { inputSchema: prebuild(config.inputSchema) } : {}),
          ...(config.outputSchema ? { outputSchema: prebuild(config.outputSchema) } : {}),
        },
        cb,
      });
    },
  };
  registerAllTools(recorder as unknown as McpServer);
  registrations = recorded;
  return registrations;
}

function buildServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });
  // Replaying recorded definitions loses `registerTool`'s per-call generics; the
  // definitions were typed at their original call sites, so widen once here.
  const register = server.registerTool.bind(server) as (
    name: string,
    config: ToolConfig,
    cb: ToolRegistration['cb'],
  ) => unknown;
  for (const { name, config, cb } of toolRegistrations()) {
    register(name, config, cb);
  }
  server.registerPrompt(
    'librarian',
    {
      title: 'Silo Librarian',
      description: 'Help the owner read and manage their Silo library.',
    },
    () => ({ messages: [{ role: 'user', content: { type: 'text', text: librarianMcpPersona } }] }),
  );
  return server;
}

let toolsList: Promise<ListToolsResult> | undefined;

/**
 * The `tools/list` result, computed once per process. The SDK re-runs the
 * Zod -> JSON Schema conversion for all tools on every call (~26 ms CPU, 186 KB
 * of which ~141 KB is `outputSchema`); the tool set never changes at runtime,
 * so the answer is fixed. It is produced by the SDK's own handler (asked over
 * an in-memory transport), so it is byte-identical to what an unmemoized server
 * returns, and cannot drift from it on an SDK upgrade.
 */
function cachedToolsList(): Promise<ListToolsResult> {
  toolsList ??= (async () => {
    const reference = buildServer();
    const [client, server] = InMemoryTransport.createLinkedPair();
    const response = new Promise<ListToolsResult>((resolve, reject) => {
      client.onmessage = (message) => {
        if ('result' in message) resolve(message.result as ListToolsResult);
        else reject(new Error('reference tools/list failed'));
      };
    });
    await reference.connect(server);
    await client.start();
    await client.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    try {
      return await response;
    } finally {
      await reference.close();
    }
  })();
  toolsList.catch(() => {
    toolsList = undefined; // do not cache a failure
  });
  return toolsList;
}

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
  const server = buildServer();
  server.server.setRequestHandler(ListToolsRequestSchema, () => cachedToolsList());
  return server;
}
