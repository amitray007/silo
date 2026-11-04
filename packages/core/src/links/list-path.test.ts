import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as LinksOps from './links.js';
import { LIST_SNIPPET_MAX_CHARS } from './list-snippet.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

function reference(text: string | null): string | null {
  const collapsed = text?.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= LIST_SNIPPET_MAX_CHARS) return collapsed;
  const hardCut = collapsed.slice(0, LIST_SNIPPET_MAX_CHARS);
  const lastSpace = hardCut.lastIndexOf(' ');
  const cut = lastSpace > LIST_SNIPPET_MAX_CHARS * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut}…`;
}

describeIfPg('list path (integration)', () => {
  const harness = setupPgHarness('silo_core_list_path_test', () => import('./links.js'));
  let ops: typeof LinksOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    ops = harness.mod();
    rawDb = harness.rawDb();
  });

  async function seed(
    url: string,
    extractedText: string | null,
    extra: { description?: string } = {},
  ) {
    const link = await ops.createLink({ url, title: url, sourceKind: 'link', ...extra });
    // Write the text directly so no capture-side normalisation touches the whitespace under test.
    await rawDb.execute(
      sql`update links set extracted_text = ${extractedText} where id = ${link.id}`,
    );
    return link;
  }

  describe('snippet from a bounded text prefix', () => {
    const texts: Record<string, string> = {
      'paragraph breaks': 'Intro line.\n\n'.repeat(400),
      'leading padding past the prefix': `${' \n'.repeat(3000)}Then the body starts here and runs on. ${'more words '.repeat(100)}`,
      'exactly 200 visible chars then padding': `${'x'.repeat(200)}${' '.repeat(6000)}`,
      'a 201st char only past the prefix': `${'x'.repeat(200)}${' '.repeat(6000)}z`,
      'one word per long whitespace run': `${'word\n\n\n\n\n\n\n\n\n\n'.repeat(500)}`,
      'non-breaking spaces': `${' '.repeat(3000)}hello${' '.repeat(3000)}world`,
      'astral characters': `${'😀 '.repeat(1500)}`,
      'all whitespace': ' \n\t '.repeat(2000),
      short: 'just a few words',
      'empty string': '',
    };

    it.each(Object.entries(texts))(
      'is identical to collapsing the whole text: %s',
      async (name, text) => {
        const created = await seed(
          `https://example.com/snippet-${name.replace(/\W+/g, '-')}`,
          text,
        );
        const { links: page } = await ops.list({}, { limit: 100 });
        const row = page.find((l) => l.id === created.id);
        expect(row?.snippet).toBe(reference(text));
        expect(row).not.toHaveProperty('extractedText');
        expect(row).not.toHaveProperty('searchVector');
      },
    );

    it('an all-whitespace extracted text yields no snippet and does not fall back to the description', async () => {
      const created = await seed('https://example.com/snippet-blank', ' \n '.repeat(2000), {
        description: 'ignored description',
      });
      const { links: page } = await ops.list();
      expect(page.find((l) => l.id === created.id)?.snippet).toBeNull();
    });

    it('a long description is cut the same way when there is no extracted text', async () => {
      const description = `${'desc word\n\n'.repeat(300)}`;
      const created = await seed('https://example.com/snippet-desc', null, { description });
      const { links: page } = await ops.list();
      expect(page.find((l) => l.id === created.id)?.snippet).toBe(reference(description));
    });

    it('keeps the saved-link id and tags on list rows', async () => {
      const created = await ops.createLink({
        url: 'https://example.com/with-tags',
        sourceKind: 'link',
        tags: ['Beta', 'alpha'],
      });
      const { links: page } = await ops.list();
      const row = page.find((l) => l.id === created.id);
      expect(row?.tags).toEqual(['Beta', 'alpha'].sort());
      expect(row?.savedLinkId).toBeNull();
    });
  });

  describe('tag filter', () => {
    async function link(name: string, tagNames: string[]) {
      return ops.createLink({
        url: `https://example.com/${name}`,
        sourceKind: 'link',
        tags: tagNames,
      });
    }

    it('matches case-insensitively and ignores surrounding whitespace', async () => {
      const a = await link('a', ['Rust']);
      await link('b', ['go']);
      for (const tag of ['rust', 'RUST', '  Rust  ']) {
        const { links: page } = await ops.list({ tag });
        expect(page.map((l) => l.id)).toEqual([a.id]);
      }
    });

    it('requires every tag when several are given (AND)', async () => {
      const both = await link('both', ['x', 'y']);
      await link('only-x', ['x']);
      await link('only-y', ['Y']);
      const { links: page } = await ops.list({ tags: ['X', 'y'] });
      expect(page.map((l) => l.id)).toEqual([both.id]);
    });

    it('folds the singular tag into tags without double counting', async () => {
      const both = await link('both', ['x', 'y']);
      await link('only-x', ['x']);
      const { links: page } = await ops.list({ tag: 'x', tags: ['x', 'y'] });
      expect(page.map((l) => l.id)).toEqual([both.id]);
    });

    it('returns nothing for an unknown tag, alone or alongside a known one', async () => {
      await link('known', ['known']);
      expect((await ops.list({ tag: 'nope' })).links).toEqual([]);
      expect((await ops.list({ tags: ['known', 'nope'] })).links).toEqual([]);
      expect((await ops.list({ tag: '   ' })).links).toEqual([]);
    });

    it('treats empty entries in tags as no restriction', async () => {
      const a = await link('a', ['t']);
      await link('b', []);
      const { links: page } = await ops.list({ tags: ['', 't'] });
      expect(page.map((l) => l.id)).toEqual([a.id]);
    });

    it('a tag that exists but sits on no link returns nothing', async () => {
      const { createTag } = await import('./tags.js');
      await createTag('lonely');
      await link('a', ['other']);
      expect((await ops.list({ tag: 'lonely' })).links).toEqual([]);
    });

    it('does not list trashed links, and still pages past the tag filter by cursor', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await link(`p${i}`, ['page'])).id);
      await ops.softDelete(ids[2] as string);
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await ops.list(
          { tag: 'page' },
          cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
        );
        seen.push(...result.links.map((l) => l.id));
        cursor = result.nextCursor;
      } while (cursor !== undefined);
      expect(seen.sort()).toEqual(ids.filter((id) => id !== ids[2]).sort());
    });

    it('pages identically whether the rarest required tag is selective or the library is walked', async () => {
      // 1,200 links carry "common" (past the selective-tag cutoff); every 40th also carries "rare".
      await rawDb.execute(sql`
        insert into links (url, canonical_url, source_kind, created_at)
        select 'https://example.com/bulk/' || n, 'https://example.com/bulk/' || n, 'link',
               now() - (n || ' minutes')::interval
        from generate_series(1, 1200) as n`);
      await rawDb.execute(
        sql`insert into tags (name, normalized_key) values ('common', 'common'), ('rare', 'rare'), ('solo', 'solo')`,
      );
      await rawDb.execute(sql`
        insert into link_tags (link_id, tag_id)
        select l.id, t.id from links l join tags t on t.normalized_key = 'common'`);
      await rawDb.execute(sql`
        insert into link_tags (link_id, tag_id)
        select l.id, t.id from links l join tags t on t.normalized_key = 'rare'
        where split_part(l.url, '/bulk/', 2)::int % 40 = 0`);

      const walk = async (filter: Parameters<typeof LinksOps.list>[0], limit: number) => {
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const result = await ops.list(
            filter,
            cursor === undefined ? { limit } : { limit, cursor },
          );
          seen.push(...result.links.map((l) => l.id));
          cursor = result.nextCursor;
        } while (cursor !== undefined);
        return seen;
      };
      const expected = async (key: string) => {
        const rows = await rawDb.execute<{ id: string }>(sql`
          select l.id from links l join link_tags lt on lt.link_id = l.id join tags t on t.id = lt.tag_id
          where t.normalized_key = ${key} and l.deleted_at is null and l.feed_id is null
          order by l.created_at desc, l.id desc`);
        return rows.rows.map((r) => r.id);
      };

      expect(await expected('common')).toHaveLength(1200);
      expect(await expected('rare')).toHaveLength(30);
      expect(await walk({ tag: 'common' }, 100)).toEqual(await expected('common'));
      expect(await walk({ tag: 'rare' }, 7)).toEqual(await expected('rare'));
      expect(await walk({ tags: ['COMMON', 'rare'] }, 7)).toEqual(await expected('rare'));
      expect(await walk({ tag: 'solo' }, 7)).toEqual([]);
      expect(await walk({ tags: ['rare', 'solo'] }, 7)).toEqual([]);
    }, 60_000);

    it('countLinks applies the same tag semantics, and an unknown tag counts zero', async () => {
      await link('both', ['x', 'y']);
      await link('only-x', ['x']);
      expect((await ops.countLinks({ tags: ['X', 'y'] })).total).toBe(1);
      expect((await ops.countLinks({ tag: 'x' })).total).toBe(2);
      expect(await ops.countLinks({ tag: 'nope' })).toEqual({
        total: 0,
        bySource: {},
        topTags: [],
      });
    });
  });

  describe('counts', () => {
    it('lists the per-source breakdown in source order', async () => {
      await ops.createLink({
        url: 'https://news.ycombinator.com/item?id=1',
        sourceKind: 'hacker_news',
      });
      await ops.createLink({ url: 'https://example.com/z', sourceKind: 'youtube' });
      await ops.createLink({ url: 'https://example.com/a', sourceKind: 'link' });
      const counts = await ops.countLinks({});
      expect(Object.keys(counts.bySource)).toEqual(['hacker_news', 'link', 'youtube']);
    });
  });

  describe('migration', () => {
    it('has the keyset index the list path walks', async () => {
      const rows = await rawDb.execute<{ indexname: string; indexdef: string }>(
        sql`select indexname, indexdef from pg_indexes where indexname in (
          'links_library_order_idx', 'links_library_counts_idx', 'highlights_created_at_id_idx')
          order by indexname`,
      );
      expect(rows.rows.map((r) => r.indexname)).toEqual([
        'highlights_created_at_id_idx',
        'links_library_counts_idx',
        'links_library_order_idx',
      ]);
      const keyset = rows.rows.find((r) => r.indexname === 'links_library_order_idx');
      expect(keyset?.indexdef).toContain('created_at DESC');
      expect(keyset?.indexdef).toMatch(/WHERE \(\(deleted_at IS NULL\) AND \(feed_id IS NULL\)\)/);
    });
  });
});
