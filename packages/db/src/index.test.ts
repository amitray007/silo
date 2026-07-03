import { beforeAll, describe, expect, it } from 'vitest';

// client.ts reads DATABASE_URL at module-load time, so it must be stubbed
// before the dynamic import below. This is a pure wiring smoke test — no
// connection is opened (pg.Pool connects lazily). Real connectivity is
// exercised by the migrate() integration check (see U1 verification), which
// needs a real Postgres and isn't run under `vitest`.
beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

describe('@silo/db exports', () => {
  it('exposes the drizzle client and pool singletons', async () => {
    const { db, pool } = await import('./index.js');
    expect(db).toBeDefined();
    expect(pool).toBeDefined();
  });
});
