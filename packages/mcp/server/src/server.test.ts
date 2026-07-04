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
