import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type LibrarianToolSource, setLibrarianToolSource } from '@silo/core/ai-credential';
import { createSiloMcpServer } from '@silo/mcp-server';
export async function registerLibrarianTools() {
  const server = createSiloMcpServer();
  const client = new Client({ name: 'silo-librarian', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const source: LibrarianToolSource = {
    list: async () =>
      (await client.listTools()).tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
      })),
    call: async (name, args, signal) => {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        signal ? { signal } : undefined,
      );
      const content = Array.isArray(result.content) ? result.content : [];
      return {
        text: content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
        ...(result.structuredContent === undefined ? {} : { structured: result.structuredContent }),
        isError: result.isError === true,
      };
    },
  };
  setLibrarianToolSource(source);
  return {
    source,
    close: async () => {
      setLibrarianToolSource(undefined);
      await client.close();
      await server.close();
    },
  };
}
