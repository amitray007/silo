import { describe, expect, it } from 'vitest';
import { createSiloMcpServer } from './server.js';

describe('createSiloMcpServer', () => {
  it('builds an McpServer instance (C2: server wiring is sound)', () => {
    const server = createSiloMcpServer();
    expect(server).toBeDefined();
    // The SDK exposes the underlying low-level server; its presence proves the
    // McpServer constructed without throwing (bad serverInfo/options would).
    expect(server.server).toBeDefined();
  });

  it('registers zero tools yet (tools arrive in C3–C5)', async () => {
    const server = createSiloMcpServer();
    // No tools registered at this unit; listing yields an empty set. Guard
    // against a future accidental registration slipping into the scaffold.
    // The SDK tracks registered tools internally; a fresh server has none.
    const anyServer = server as unknown as { _registeredTools?: Record<string, unknown> };
    expect(Object.keys(anyServer._registeredTools ?? {})).toHaveLength(0);
  });
});
