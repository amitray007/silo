import { beforeAll, describe, expect, it } from 'vitest';

// @silo/core (imported by ./index.ts) transitively imports @silo/db, whose
// `db`/`pool` singleton reads DATABASE_URL at module-load time (see
// packages/db/src/client.ts). This is a pure wiring smoke test — no
// connection is opened (pg.Pool connects lazily) — so a syntactically valid
// placeholder is enough (same pattern as packages/db/src/index.test.ts).
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

describe('@silo/web placeholder', () => {
  it('exports a defined marker', async () => {
    const { name } = await import('./index.js');
    expect(name).toBeDefined();
    expect(name).toBe('@silo/web');
  });

  it('resolves the @silo/core workspace link', async () => {
    const { coreDependencyName } = await import('./index.js');
    expect(coreDependencyName).toBe('@silo/core');
  });
});
