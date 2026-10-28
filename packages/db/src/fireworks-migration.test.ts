import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { createDisposableDatabase, postgresReachable } from './test-support/disposable-database.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('0021 Fireworks migration', () => {
  it('upgrades 0020 using the real transactional migrator, preserves keys, and allows Fireworks after commit', async () => {
    const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8')) as {
      entries: { tag: string }[];
    };
    const index = journal.entries.findIndex((entry) => entry.tag === '0021_fireworks');
    expect(index).toBe(21);
    const entries = journal.entries.slice(0, index);
    expect(entries.at(-1)?.tag).toBe('0020_title_source');
    const dir = mkdtempSync(path.join(tmpdir(), 'silo-before-fireworks-'));
    const database = createDisposableDatabase('silo_fireworks_migration');
    const check = new Pool({ connectionString: database.url });
    try {
      mkdirSync(path.join(dir, 'meta'));
      writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries)
        writeFileSync(
          path.join(dir, `${entry.tag}.sql`),
          readFileSync(`./drizzle/${entry.tag}.sql`),
        );
      const before = new Pool({ connectionString: database.url });
      await runMigrations(drizzle(before), before, dir);
      await check.query(
        "INSERT INTO ai_providers (kind, encrypted_key, key_last4) VALUES ('anthropic', 'old-ciphertext', '1234')",
      );
      const upgrade = new Pool({ connectionString: database.url });
      await runMigrations(drizzle(upgrade), upgrade, './drizzle');
      expect(
        (await check.query('SELECT encrypted_key, models, models_fetched_at FROM ai_providers'))
          .rows,
      ).toEqual([{ encrypted_key: 'old-ciphertext', models: null, models_fetched_at: null }]);
      await check.query(
        "INSERT INTO ai_providers (kind, encrypted_key, key_last4, models, models_fetched_at) VALUES ('fireworks', 'fake-ciphertext', '5678', '[]', now())",
      );
      expect(
        (
          await check.query(
            "SELECT kind, models_fetched_at FROM ai_providers WHERE kind = 'fireworks'",
          )
        ).rows[0],
      ).toMatchObject({ kind: 'fireworks', models_fetched_at: expect.any(Date) });
      const again = new Pool({ connectionString: database.url });
      await runMigrations(drizzle(again), again, './drizzle');
    } finally {
      await check.end();
      database.drop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
