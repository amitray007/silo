import { describe, expect, it, vi } from 'vitest';

const clientMock = vi.hoisted(() => ({
  db: { __kind: 'db' },
  pool: { __kind: 'pool' },
}));

vi.mock('./client.js', () => clientMock);

describe('@silo/db exports', () => {
  it('exposes the drizzle client and pool singletons', async () => {
    const { db, pool } = await import('./index.js');
    expect(db).toBe(clientMock.db);
    expect(pool).toBe(clientMock.pool);
  }, 10_000);
});
