import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const suite = postgresReachable() ? describe : describe.skip;
suite('in-memory Librarian MCP', () => {
  let drop: () => void;
  let handle: Awaited<ReturnType<typeof import('./librarian-tools.js')['registerLibrarianTools']>>;
  let db: typeof import('@silo/db');
  beforeAll(async () => {
    const database = createDisposableDatabase('silo_librarian_tools');
    drop = database.drop;
    const pool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(pool), pool, '../db/drizzle');
    process.env.DATABASE_URL = database.url;
    db = await import('@silo/db');
    handle = await (await import('./librarian-tools.js')).registerLibrarianTools();
  });
  afterAll(async () => {
    await handle?.close();
    await db?.pool.end();
    drop?.();
  });
  it('lists all 34 tools and calls get_link against a seeded database', async () => {
    const tools = await handle.source.list();
    expect(tools).toHaveLength(34);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['get_link', 'hard_delete_link', 'export_links']),
    );
    const [link] = await db.db
      .insert(db.links)
      .values({
        url: 'https://example.com/librarian',
        canonicalUrl: 'https://example.com/librarian',
        title: 'Librarian source',
        sourceKind: 'web',
        captureStatus: 'full',
      })
      .returning();
    if (!link) throw new Error('missing link');
    const result = await handle.source.call('get_link', { id: link.id });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Librarian source');
  });
});
