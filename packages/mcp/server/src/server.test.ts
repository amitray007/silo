import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { beforeAll, describe, expect, it } from 'vitest';

// `server.ts` now registers `get_link` (C3), which transitively imports
// `@silo/core` -> `@silo/db`, whose `db`/`pool` singleton reads DATABASE_URL
// at module-load time (see packages/db/src/client.ts). This is a pure wiring
// smoke test — no connection is opened (pg.Pool connects lazily) — so a
// syntactically valid placeholder is enough (same pattern as
// packages/api/src/core-link.test.ts). Dynamic-import `./server.js` so the
// env var is set before its module graph first loads.
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

describe('createSiloMcpServer', () => {
  it('builds an McpServer instance (C2: server wiring is sound)', async () => {
    const { createSiloMcpServer } = await import('./server.js');
    const server = createSiloMcpServer();
    expect(server).toBeDefined();
    // The SDK exposes the underlying low-level server; its presence proves the
    // McpServer constructed without throwing (bad serverInfo/options would).
    expect(server.server).toBeDefined();
  });

  it('registers get_link (C3); search_links/list_links land in C4/C5', async () => {
    const { createSiloMcpServer } = await import('./server.js');
    const server = createSiloMcpServer();
    // The SDK tracks registered tools internally; assert by name rather than
    // count so C4/C5 adding more tools doesn't need to touch this assertion.
    const anyServer = server as unknown as { _registeredTools?: Record<string, unknown> };
    expect(Object.keys(anyServer._registeredTools ?? {})).toContain('get_link');
  });
});

type RegisteredTools = Record<
  string,
  { inputSchema?: unknown; outputSchema?: unknown; handler: unknown }
>;

function registeredTools(server: McpServer): RegisteredTools {
  return (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;
}

/** Sends one JSON-RPC request to `server` over a fresh in-memory pair; returns its `result`. */
async function request(server: McpServer, method: string, params = {}): Promise<unknown> {
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const reply = new Promise<JSONRPCMessage>((resolve) => {
    client.onmessage = resolve;
  });
  await server.connect(serverSide);
  await client.start();
  await client.send({ jsonrpc: '2.0', id: 1, method, params });
  const message = await reply;
  await server.close();
  return 'result' in message ? message.result : message;
}

describe('createSiloMcpServer: shared tool definitions', () => {
  it('gives every call its own server but reuses one prebuilt set of schemas and handlers', async () => {
    const { createSiloMcpServer } = await import('./server.js');
    const a = createSiloMcpServer();
    const b = createSiloMcpServer();
    expect(a).not.toBe(b);
    expect(registeredTools(a)).not.toBe(registeredTools(b));

    const toolsA = registeredTools(a);
    const toolsB = registeredTools(b);
    expect(Object.keys(toolsA)).toHaveLength(34);
    expect(Object.keys(toolsB)).toEqual(Object.keys(toolsA));
    for (const name of Object.keys(toolsA)) {
      expect(toolsB[name]?.inputSchema, `${name} inputSchema`).toBe(toolsA[name]?.inputSchema);
      expect(toolsB[name]?.outputSchema, `${name} outputSchema`).toBe(toolsA[name]?.outputSchema);
      expect(toolsB[name]?.handler, `${name} handler`).toBe(toolsA[name]?.handler);
    }
  });

  it('tools/list is computed once per process and is identical to the SDK default', async () => {
    const { createSiloMcpServer, registerAllTools } = await import('./server.js');
    const first = await request(createSiloMcpServer(), 'tools/list');
    const second = await request(createSiloMcpServer(), 'tools/list');
    // Same object: the Zod -> JSON Schema conversion did not run again.
    expect(second).toBe(first);

    // A server wired the way it was before any caching: plain SDK handler, schemas built per
    // registration. The memoized answer must match it byte for byte (outputSchema included).
    const plain = new McpServer({ name: 'silo', version: '0.0.0' }, { instructions: 'x' });
    registerAllTools(plain);
    const reference = await request(plain, 'tools/list');
    expect(JSON.stringify(first)).toBe(JSON.stringify(reference));
    const tools = (first as { tools: Array<{ outputSchema?: unknown }> }).tools;
    expect(tools).toHaveLength(34);
    expect(tools.some((tool) => tool.outputSchema !== undefined)).toBe(true);
  });

  it('keeps initialize (instructions, capabilities) unchanged', async () => {
    const { createSiloMcpServer } = await import('./server.js');
    const result = (await request(createSiloMcpServer(), 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    })) as { serverInfo: unknown; capabilities: unknown; instructions: string };
    expect(result.serverInfo).toEqual({ name: 'silo', version: '0.0.0' });
    expect(result.capabilities).toEqual({
      tools: { listChanged: true },
      prompts: { listChanged: true },
    });
    expect(result.instructions).toMatch(/^Silo is a personal link store\./);
  });
});

it('lists and retrieves the Librarian prompt over MCP', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { librarianMcpPersona } = await import('@silo/core');
  const { createSiloMcpServer } = await import('./server.js');
  const server = createSiloMcpServer();
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    expect((await client.listPrompts()).prompts).toContainEqual(
      expect.objectContaining({ name: 'librarian', title: 'Silo Librarian' }),
    );
    expect((await client.getPrompt({ name: 'librarian' })).messages).toEqual([
      { role: 'user', content: { type: 'text', text: librarianMcpPersona } },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
