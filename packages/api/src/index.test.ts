import { beforeAll, describe, expect, it } from 'vitest';

// `index.ts` re-exports `createApp`/`toLinkJson`, both of which transitively
// import `@silo/core` -> `@silo/db`, whose `db`/`pool` singleton reads
// DATABASE_URL at module-load time (see packages/db/src/client.ts). Same
// placeholder-env + dynamic-import pattern as app.test.ts/server.test.ts.
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

describe('@silo/api public surface', () => {
  it('exports createApp, a function that builds a Hono instance', async () => {
    const { createApp } = await import('./index.js');
    expect(createApp).toBeDefined();
    expect(createApp()).toBeDefined();
    // Route-level behavior (health/404/onError) is covered by app.test.ts —
    // this only proves the re-export from the package's public entry works.
  });

  it('exports the link-json shaper', async () => {
    const { toLinkJson } = await import('./index.js');
    expect(toLinkJson).toBeDefined();
  });
});
