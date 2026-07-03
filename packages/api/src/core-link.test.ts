import { beforeAll, describe, expect, it } from 'vitest';

// @silo/core transitively imports @silo/db, whose `db`/`pool` singleton
// reads DATABASE_URL at module-load time (see packages/db/src/client.ts).
// This is a pure wiring smoke test — no connection is opened (pg.Pool
// connects lazily) — so a syntactically valid placeholder is enough (same
// pattern as packages/db/src/index.test.ts).
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

describe('@silo/api -> @silo/core workspace link', () => {
  it('resolves the @silo/core placeholder through the workspace:* dependency', async () => {
    const { name: coreName } = await import('@silo/core');
    expect(coreName).toBeDefined();
    expect(coreName).toBe('@silo/core');
  });
});
