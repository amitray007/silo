import { beforeAll, describe, expect, it } from 'vitest';

// `./index.js` re-exports `createSiloMcpServer`, which (since C3) transitively
// imports `@silo/core` -> `@silo/db`, whose `db`/`pool` singleton reads
// DATABASE_URL at module-load time. Same placeholder-env + dynamic-import
// pattern as `server.test.ts` — see that file's comment for the full reason.
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

describe('@silo/mcp-server placeholder', () => {
  it('exports a defined marker', async () => {
    const { name } = await import('./index.js');
    expect(name).toBeDefined();
    expect(name).toBe('@silo/mcp-server');
  });
});
