import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrate.js';
import {
  createDisposableDatabase,
  postgresReachable,
} from '../test-support/disposable-database.js';
import { linkTags } from './link-tags.js';
import { links } from './links.js';
import { tags } from './tags.js';

// Integration tests: they need a real Postgres, since generated columns,
// partial-unique constraints, and full-text ranking are database behaviors
// that mocks can't prove (see docs/rules/testing.md). Disposable database
// per suite, dropped after. Skipped (not failed) if no local Postgres.
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('links schema (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let dropDatabase: () => void;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_links_test');
    dropDatabase = database.drop;

    const migratePool = new Pool({ connectionString: database.url });
    const migrateDb = drizzle(migratePool);
    // runMigrations closes migratePool for us.
    await runMigrations(migrateDb, migratePool, './drizzle');

    pool = new Pool({ connectionString: database.url });
    db = drizzle(pool);
  });

  afterAll(async () => {
    await pool.end();
    dropDatabase();
  });

  afterEach(async () => {
    // link_tags rows cascade from the FKs; clear both tables between tests.
    await db.execute(sql`TRUNCATE TABLE link_tags, links, tags RESTART IDENTITY CASCADE`);
  });

  it('populates search_vector automatically and matches a title term via websearch_to_tsquery', async () => {
    await db.insert(links).values({
      url: 'https://example.com/rust-guide',
      canonicalUrl: 'https://example.com/rust-guide',
      title: 'Rust programming guide',
      description: 'about systems programming',
      extractedText: 'a long article body about ownership and borrowing',
      sourceKind: 'link',
    });

    const rows = await db.execute<{ title: string }>(
      sql`select title from links where search_vector @@ websearch_to_tsquery('english', 'rust')`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.title).toBe('Rust programming guide');
  });

  it('ranks a title match above a body-only match via ts_rank (weighting A > C)', async () => {
    await db.insert(links).values([
      {
        url: 'https://example.com/title-match',
        canonicalUrl: 'https://example.com/title-match',
        title: 'octopus',
        sourceKind: 'link',
      },
      {
        url: 'https://example.com/body-match',
        canonicalUrl: 'https://example.com/body-match',
        title: 'unrelated headline',
        extractedText: 'a story that mentions octopus deep in the body text',
        sourceKind: 'link',
      },
    ]);

    const rows = await db.execute<{ url: string; rank: number }>(
      sql`select url, ts_rank(search_vector, websearch_to_tsquery('english', 'octopus')) as rank
          from links
          where search_vector @@ websearch_to_tsquery('english', 'octopus')
          order by rank desc`,
    );

    expect(rows.rows).toHaveLength(2);
    const [titleMatch, bodyMatch] = rows.rows;
    expect(titleMatch?.url).toBe('https://example.com/title-match');
    expect(titleMatch?.rank).toBeGreaterThan(bodyMatch?.rank ?? Number.POSITIVE_INFINITY);
  });

  it('rejects a second live row with the same canonical_url (partial-unique dedup)', async () => {
    await db.insert(links).values({
      url: 'https://example.com/dup?utm_source=x',
      canonicalUrl: 'https://example.com/dup',
      sourceKind: 'link',
    });

    // Drizzle wraps the pg driver error; the real Postgres error (code 23505,
    // "duplicate key value violates unique constraint ...") is on `.cause`.
    const error = await db
      .insert(links)
      .values({
        url: 'https://example.com/dup?utm_source=y',
        canonicalUrl: 'https://example.com/dup',
        sourceKind: 'link',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect((cause as { code?: string } | undefined)?.code).toBe('23505');
    expect((cause as { message?: string } | undefined)?.message).toMatch(
      /links_canonical_url_live_unique_idx/,
    );
  });

  it('allows the same canonical_url when one row is soft-deleted (trash frees the slot)', async () => {
    const [trashed] = await db
      .insert(links)
      .values({
        url: 'https://example.com/reused',
        canonicalUrl: 'https://example.com/reused',
        sourceKind: 'link',
      })
      .returning({ id: links.id });
    if (!trashed) {
      throw new Error('expected insert().returning() to return the inserted row');
    }

    await db.update(links).set({ deletedAt: new Date() }).where(sql`${links.id} = ${trashed.id}`);

    // Same canonical_url, new live row — must succeed since the unique index
    // is scoped to `WHERE deleted_at IS NULL`.
    await expect(
      db.insert(links).values({
        url: 'https://example.com/reused',
        canonicalUrl: 'https://example.com/reused',
        sourceKind: 'link',
      }),
    ).resolves.not.toThrow();

    const rows = await db.execute<{ count: string }>(
      sql`select count(*) from links where canonical_url = 'https://example.com/reused'`,
    );
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('populates search_vector from notes (weight D) and matches via websearch_to_tsquery (H2)', async () => {
    await db.insert(links).values({
      url: 'https://example.com/notes-only',
      canonicalUrl: 'https://example.com/notes-only',
      title: 'unrelated title',
      notes: 'a distinctivenotesword only appears in this personal annotation',
      sourceKind: 'link',
    });

    const rows = await db.execute<{ url: string }>(
      sql`select url from links where search_vector @@ websearch_to_tsquery('english', 'distinctivenotesword')`,
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.url).toBe('https://example.com/notes-only');
  });

  it('ranks a title match above a notes-only match (weighting A > D)', async () => {
    await db.insert(links).values([
      {
        url: 'https://example.com/notes-vs-title-a',
        canonicalUrl: 'https://example.com/notes-vs-title-a',
        title: 'narwhal',
        sourceKind: 'link',
      },
      {
        url: 'https://example.com/notes-vs-title-b',
        canonicalUrl: 'https://example.com/notes-vs-title-b',
        title: 'unrelated headline',
        notes: 'a note that happens to mention narwhal in passing',
        sourceKind: 'link',
      },
    ]);

    const rows = await db.execute<{ url: string; rank: number }>(
      sql`select url, ts_rank(search_vector, websearch_to_tsquery('english', 'narwhal')) as rank
          from links
          where search_vector @@ websearch_to_tsquery('english', 'narwhal')
          order by rank desc`,
    );

    expect(rows.rows).toHaveLength(2);
    const [titleMatch, notesMatch] = rows.rows;
    expect(titleMatch?.url).toBe('https://example.com/notes-vs-title-a');
    expect(titleMatch?.rank).toBeGreaterThan(notesMatch?.rank ?? Number.POSITIVE_INFINITY);
  });

  it('populates search_vector from canonical_url and matches domain/path words (search-url method)', async () => {
    await db.insert(links).values({
      url: 'https://github.com/amitray007/silo',
      canonicalUrl: 'https://github.com/amitray007/silo',
      sourceKind: 'link',
    });

    const matchesFor = async (term: string): Promise<boolean> => {
      const rows = await db.execute<{ url: string }>(
        sql`select url from links where search_vector @@ websearch_to_tsquery('english', ${term})`,
      );
      return rows.rows.length === 1;
    };

    expect(await matchesFor('amitray007')).toBe(true);
    expect(await matchesFor('silo')).toBe(true);
    expect(await matchesFor('github')).toBe(true);
  });

  it('ranks a title match above a url-only match (weighting A > C)', async () => {
    await db.insert(links).values([
      {
        url: 'https://example.com/quibbleflarn-title',
        canonicalUrl: 'https://example.com/quibbleflarn-title',
        title: 'quibbleflarn',
        sourceKind: 'link',
      },
      {
        url: 'https://quibbleflarn.example.com/unrelated',
        canonicalUrl: 'https://quibbleflarn.example.com/unrelated',
        title: 'unrelated headline',
        sourceKind: 'link',
      },
    ]);

    const rows = await db.execute<{ url: string; rank: number }>(
      sql`select url, ts_rank(search_vector, websearch_to_tsquery('english', 'quibbleflarn')) as rank
          from links
          where search_vector @@ websearch_to_tsquery('english', 'quibbleflarn')
          order by rank desc`,
    );

    expect(rows.rows).toHaveLength(2);
    const [titleMatch, urlMatch] = rows.rows;
    expect(titleMatch?.url).toBe('https://example.com/quibbleflarn-title');
    expect(titleMatch?.rank).toBeGreaterThan(urlMatch?.rank ?? Number.POSITIVE_INFINITY);
  });

  it('does NOT match "amitray" alone against a stored "amitray007" token (documents the digit-joined caveat)', async () => {
    await db.insert(links).values({
      url: 'https://github.com/amitray007/silo',
      canonicalUrl: 'https://github.com/amitray007/silo',
      sourceKind: 'link',
    });

    const rows = await db.execute<{ url: string }>(
      sql`select url from links where search_vector @@ websearch_to_tsquery('english', 'amitray')`,
    );

    expect(rows.rows).toHaveLength(0);
  });

  it('produces a non-null search_vector when description and extracted_text are null (coalesce)', async () => {
    await db.insert(links).values({
      url: 'https://example.com/title-only',
      canonicalUrl: 'https://example.com/title-only',
      title: 'just a title',
      sourceKind: 'link',
    });

    const rows = await db.execute<{ search_vector: string | null }>(
      sql`select search_vector from links where url = 'https://example.com/title-only'`,
    );

    expect(rows.rows[0]?.search_vector).not.toBeNull();
    expect(rows.rows[0]?.search_vector).toContain('titl');
  });

  it('rejects a capture_status value outside the enum', async () => {
    await expect(
      db.execute(
        sql`insert into links (url, canonical_url, source_kind, capture_status)
            values ('https://example.com/bad-status', 'https://example.com/bad-status', 'link', 'not-a-real-status')`,
      ),
    ).rejects.toThrow();
  });

  it('cascades link_tags deletion when the owning link is deleted', async () => {
    const [link] = await db
      .insert(links)
      .values({
        url: 'https://example.com/tagged',
        canonicalUrl: 'https://example.com/tagged',
        sourceKind: 'link',
      })
      .returning({ id: links.id });
    const [tag] = await db
      .insert(tags)
      .values({ name: 'reading', normalizedKey: 'reading' })
      .returning({ id: tags.id });
    if (!link || !tag) {
      throw new Error('expected insert().returning() to return the inserted rows');
    }

    await db.insert(linkTags).values({ linkId: link.id, tagId: tag.id });

    let joinRows = await db.execute(sql`select * from link_tags where link_id = ${link.id}`);
    expect(joinRows.rows).toHaveLength(1);

    await db.delete(links).where(sql`${links.id} = ${link.id}`);

    joinRows = await db.execute(sql`select * from link_tags where link_id = ${link.id}`);
    expect(joinRows.rows).toHaveLength(0);

    // The tag row itself is untouched by a link deletion.
    const tagRows = await db.execute(sql`select * from tags where id = ${tag.id}`);
    expect(tagRows.rows).toHaveLength(1);
  });

  it('enforces tags.normalized_key uniqueness (case-insensitive dedup key)', async () => {
    await db.insert(tags).values({ name: 'Unique-Tag', normalizedKey: 'unique-tag' });

    await expect(
      db.insert(tags).values({ name: 'unique-tag', normalizedKey: 'unique-tag' }),
    ).rejects.toThrow(/unique/i);
  });

  it('bumps updated_at on an ORM update ($onUpdate), leaving created_at fixed', async () => {
    const [row] = await db
      .insert(links)
      .values({ url: 'https://ex.com/u', canonicalUrl: 'https://ex.com/u', sourceKind: 'link' })
      .returning({ id: links.id, createdAt: links.createdAt, updatedAt: links.updatedAt });
    expect(row).toBeDefined();
    if (!row) return;

    // Small gap so the timestamps are distinguishable.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [updated] = await db
      .update(links)
      .set({ title: 'edited' })
      .where(sql`${links.id} = ${row.id}`)
      .returning({ createdAt: links.createdAt, updatedAt: links.updatedAt });
    expect(updated).toBeDefined();
    if (!updated) return;

    // created_at is unchanged; updated_at advanced past it.
    expect(updated.createdAt.getTime()).toBe(row.createdAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });

  it('filters live rows by capture_status (partial index access pattern)', async () => {
    await db.insert(links).values([
      { url: 'a', canonicalUrl: 'a', sourceKind: 'link', captureStatus: 'full' },
      { url: 'b', canonicalUrl: 'b', sourceKind: 'link', captureStatus: 'partial' },
      {
        url: 'c',
        canonicalUrl: 'c',
        sourceKind: 'link',
        captureStatus: 'full',
        deletedAt: new Date(),
      },
    ]);

    const liveFull = await db.execute(
      sql`select count(*)::int as n from links where capture_status = 'full' and deleted_at is null`,
    );
    // Only the one live 'full' row — the trashed 'full' row is excluded.
    expect(liveFull.rows[0]).toEqual({ n: 1 });
  });
});
