import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for the passage-highlight routes against a real
 * Postgres: create, edit, delete, validation, the error envelope, and the
 * `highlights` array on the single-link read.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

type HighlightBody = {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number | null;
  endOffset: number | null;
  color: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

describeIfPg('highlight routes (integration)', () => {
  const harness = setupPgHarness('silo_api_highlights_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    const { pool } = await import('@silo/db');
    return { core, app: createApp(), pool };
  });

  async function newLinkId(url: string, text = 'Alpha beta gamma delta.') {
    const { core, pool } = harness.mod();
    const id = (await core.createLink({ url, sourceKind: 'link' })).id;
    await pool.query('update links set extracted_text = $2 where id = $1', [id, text]);
    return id;
  }

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    return harness.mod().app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function readHighlights(id: string): Promise<HighlightBody[]> {
    const res = await send('GET', `/api/links/${id}`);
    return ((await res.json()) as { link: { highlights: HighlightBody[] } }).link.highlights;
  }

  it('GET /api/links/:id carries highlights: [] before anything is saved', async () => {
    expect(await readHighlights(await newLinkId('https://example.com/h-empty'))).toEqual([]);
  });

  it('POST creates (201), returns the whitelisted shape, and GET shows it', async () => {
    const id = await newLinkId('https://example.com/h-create');
    const res = await send('POST', `/api/links/${id}/highlights`, {
      quote: 'beta',
      prefix: 'Alpha ',
      suffix: ' gamma',
      startOffset: 6,
      endOffset: 10,
      color: 'blue',
      note: 'why',
    });
    expect(res.status).toBe(201);
    const { highlight } = (await res.json()) as { highlight: HighlightBody };
    expect(Object.keys(highlight).sort()).toEqual([
      'color',
      'createdAt',
      'endOffset',
      'id',
      'note',
      'prefix',
      'quote',
      'startOffset',
      'suffix',
      'updatedAt',
    ]);
    expect(highlight).toMatchObject({ quote: 'beta', color: 'blue', note: 'why' });
    expect(await readHighlights(id)).toHaveLength(1);
  });

  it('POST with only a quote matches it in the saved text', async () => {
    const id = await newLinkId('https://example.com/h-quote');
    const res = await send('POST', `/api/links/${id}/highlights`, { quote: 'gamma delta' });
    expect(res.status).toBe(201);
    const { highlight } = (await res.json()) as { highlight: HighlightBody };
    expect(highlight.prefix).toBe('Alpha beta ');
    expect(highlight.startOffset).toBeNull();
  });

  it('POST maps a quote that is not in the text to 400 invalid_highlight', async () => {
    const id = await newLinkId('https://example.com/h-missing');
    const res = await send('POST', `/api/links/${id}/highlights`, { quote: 'nowhere' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('invalid_highlight');
    expect(body.message).toMatch(/not in the saved text/);
  });

  it.each([
    ['empty quote', { quote: '' }],
    ['long quote', { quote: 'x'.repeat(5001) }],
    ['bad colour', { quote: 'a', color: 'red' }],
    ['long prefix', { quote: 'a', prefix: 'p'.repeat(65) }],
    ['long note', { quote: 'a', prefix: '', suffix: '', note: 'n'.repeat(10001) }],
    ['missing quote', {}],
    [
      'offset above int4',
      { quote: 'a', prefix: '', suffix: '', startOffset: 5, endOffset: 4_000_000_000 },
    ],
    ['NUL in quote', { quote: 'a\u0000b', prefix: '', suffix: '' }],
    ['NUL in note', { quote: 'a', prefix: '', suffix: '', note: 'x\u0000' }],
  ])('POST rejects %s with 400', async (name, body) => {
    const id = await newLinkId(`https://example.com/h-bad-${name.replace(/\W/g, '')}`);
    const res = await send('POST', `/api/links/${id}/highlights`, body);
    expect(res.status).toBe(400);
    expect(await readHighlights(id)).toEqual([]);
  });

  it('POST returns 400 for a malformed id and 404 for an unknown or trashed link', async () => {
    expect((await send('POST', '/api/links/nope/highlights', { quote: 'a' })).status).toBe(400);
    const unknown = await send(
      'POST',
      '/api/links/11111111-1111-4111-8111-111111111111/highlights',
      {
        quote: 'a',
        prefix: '',
        suffix: '',
      },
    );
    expect(unknown.status).toBe(404);
    const id = await newLinkId('https://example.com/h-trashed');
    await harness.mod().core.softDelete(id);
    const trashed = await send('POST', `/api/links/${id}/highlights`, {
      quote: 'a',
      prefix: '',
      suffix: '',
    });
    expect(trashed.status).toBe(404);
    expect(((await trashed.json()) as ErrorEnvelope).error).toBe('not_found');
  });

  it('PATCH recolours and sets then clears a note', async () => {
    const id = await newLinkId('https://example.com/h-patch');
    const created = (await (
      await send('POST', `/api/links/${id}/highlights`, { quote: 'beta' })
    ).json()) as { highlight: HighlightBody };
    const hid = created.highlight.id;
    const colour = await send('PATCH', `/api/highlights/${hid}`, { color: 'pink' });
    expect(((await colour.json()) as { highlight: HighlightBody }).highlight.color).toBe('pink');
    const note = await send('PATCH', `/api/highlights/${hid}`, { note: 'hello' });
    expect(((await note.json()) as { highlight: HighlightBody }).highlight.note).toBe('hello');
    const clear = await send('PATCH', `/api/highlights/${hid}`, { note: null });
    expect(((await clear.json()) as { highlight: HighlightBody }).highlight.note).toBeNull();
    expect((await send('PATCH', `/api/highlights/${hid}`, { color: 'red' })).status).toBe(400);
    expect((await send('PATCH', '/api/highlights/not-a-uuid', {})).status).toBe(400);
    const unknown = await send('PATCH', '/api/highlights/11111111-1111-4111-8111-111111111111', {
      note: 'x',
    });
    expect(unknown.status).toBe(404);
  });

  it('DELETE removes with 204, then 404', async () => {
    const id = await newLinkId('https://example.com/h-delete');
    const created = (await (
      await send('POST', `/api/links/${id}/highlights`, { quote: 'beta' })
    ).json()) as { highlight: HighlightBody };
    const first = await send('DELETE', `/api/highlights/${created.highlight.id}`);
    expect(first.status).toBe(204);
    expect(await readHighlights(id)).toEqual([]);
    expect((await send('DELETE', `/api/highlights/${created.highlight.id}`)).status).toBe(404);
  });

  it('feed posts answer 409 feed_post_not_editable on every write', async () => {
    const { pool } = harness.mod();
    const feed = await pool.query<{ id: string }>(
      "insert into feeds (feed_url, title, format, next_poll_at) values ('https://f.test/h', 'F', 'rss', now()) returning id",
    );
    const post = await pool.query<{ id: string }>(
      "insert into links (url, canonical_url, source_kind, feed_id, extracted_text) values ('https://f.test/hp', 'https://f.test/hp', 'link', $1, 'text here') returning id",
      [feed.rows[0]?.id],
    );
    const postId = post.rows[0]?.id ?? '';
    const add = await send('POST', `/api/links/${postId}/highlights`, { quote: 'text' });
    expect(add.status).toBe(409);
    expect(((await add.json()) as ErrorEnvelope).error).toBe('feed_post_not_editable');
    const row = await pool.query<{ id: string }>(
      "insert into highlights (link_id, quote, color) values ($1, 'text', 'yellow') returning id",
      [postId],
    );
    const hid = row.rows[0]?.id ?? '';
    expect((await send('PATCH', `/api/highlights/${hid}`, { note: 'x' })).status).toBe(409);
    expect((await send('DELETE', `/api/highlights/${hid}`)).status).toBe(409);
  });

  it('PATCH and DELETE on a trashed link answer 404', async () => {
    const id = await newLinkId('https://example.com/h-trash-edit');
    const created = (await (
      await send('POST', `/api/links/${id}/highlights`, { quote: 'beta' })
    ).json()) as { highlight: HighlightBody };
    await harness.mod().core.softDelete(id);
    expect(
      (await send('PATCH', `/api/highlights/${created.highlight.id}`, { note: 'x' })).status,
    ).toBe(404);
    expect((await send('DELETE', `/api/highlights/${created.highlight.id}`)).status).toBe(404);
  });

  it('list responses do not carry highlights, and restore-merge moves them', async () => {
    const id = await newLinkId('https://example.com/h-list');
    await send('POST', `/api/links/${id}/highlights`, { quote: 'beta' });
    const res = await send('GET', '/api/links');
    const body = (await res.json()) as { links: Array<Record<string, unknown>> };
    expect(body.links.length).toBeGreaterThan(0);
    for (const row of body.links) expect(Object.hasOwn(row, 'highlights')).toBe(false);

    await harness.mod().core.softDelete(id);
    const { pool } = harness.mod();
    const twin = await pool.query<{ id: string }>(
      "insert into links (url, canonical_url, source_kind) values ('https://example.com/h-list', 'https://example.com/h-list', 'link') returning id",
    );
    const restored = await send('POST', `/api/links/${id}/restore`);
    const merged = (await restored.json()) as {
      outcome: string;
      link: { id: string; highlights: HighlightBody[] };
    };
    expect(merged.outcome).toBe('merged');
    expect(merged.link.id).toBe(twin.rows[0]?.id);
    expect(merged.link.highlights.map((h) => h.quote)).toEqual(['beta']);
  });
  it.each([
    ['/api/highlights', 'highlights'],
    ['/api/reading-positions', 'reading_positions'],
  ])('%s returns 400 for a calendar-invalid cursor', async (path, kind) => {
    const cursor = Buffer.from(
      JSON.stringify({
        kind,
        timestamp: '2026-02-30T00:00:00Z',
        id: '00000000-0000-4000-8000-000000000001',
      }),
    ).toString('base64url');
    const res = await send('GET', `${path}?cursor=${cursor}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_cursor' });
  });

  describe('GET /api/highlights', () => {
    beforeEach(async () => {
      await harness.mod().pool.query('truncate links, feeds cascade');
    });

    it('filters passages, notes and literal characters, and returns compact rows', async () => {
      const { core } = harness.mod();
      const id = await newLinkId('https://example.com/browse', 'A 50% snake_case C:\\docs quote.');
      await core.addTag(id, 'Research');
      await core.addHighlight(id, {
        quote: '50% snake_case C:\\docs',
        note: 'Passage note',
        color: 'blue',
      });
      await core.addHighlight(id, { quote: 'quote' });
      for (const query of ['50%', '_', '\\', 'PASSAGE']) {
        const res = await send(
          'GET',
          `/api/highlights?query=${encodeURIComponent(query)}&tag=RESEARCH&hasNote=true&color=blue&linkId=${id}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { highlights: Array<Record<string, unknown>> };
        expect(body.highlights).toHaveLength(1);
        expect(Object.keys(body.highlights[0] ?? {}).sort()).toEqual([
          'color',
          'createdAt',
          'id',
          'link',
          'note',
          'quote',
          'updatedAt',
        ]);
        expect(body.highlights[0]).toMatchObject({
          link: { id, title: null, url: 'https://example.com/browse' },
          note: 'Passage note',
        });
      }
      const all = await send('GET', '/api/highlights?hasNote=false');
      expect(((await all.json()) as { highlights: unknown[] }).highlights).toHaveLength(2);
    });

    it('pages with cursors, defaults to 20, caps at 100 and excludes trash and feed posts', async () => {
      const { core, pool } = harness.mod();
      const id = await newLinkId('https://example.com/page');
      await pool.query(
        "insert into highlights (link_id, quote, color) select $1, n::text, 'yellow' from generate_series(1,105) n",
        [id],
      );
      const trashed = await newLinkId('https://example.com/browse-trash');
      await core.addHighlight(trashed, { quote: 'Alpha' });
      await core.softDelete(trashed);
      await pool.query(`with f as (
        insert into feeds (feed_url,title,format,next_poll_at) values ('https://f.test/list','F','rss',now()) returning id
      ), p as (insert into links (url,canonical_url,source_kind,feed_id) select 'https://f.test/list-post','https://f.test/list-post','link',id from f returning id)
      insert into highlights (link_id,quote,color) select id,'feed','yellow' from p`);
      const read = async (query: string) =>
        (await (await send('GET', `/api/highlights${query}`)).json()) as {
          highlights: Array<{ id: string; link: { id: string } }>;
          nextCursor?: string;
        };
      expect((await read('')).highlights).toHaveLength(20);
      const first = await read('?limit=999');
      const second = await read(`?cursor=${first.nextCursor}&limit=100`);
      const rows = [...first.highlights, ...second.highlights];
      expect(first.highlights).toHaveLength(100);
      expect(rows).toHaveLength(105);
      expect(new Set(rows.map((r) => r.id)).size).toBe(105);
      expect(rows.every((r) => r.link.id === id)).toBe(true);
      expect(second.nextCursor).toBeUndefined();
    });

    it('maps invalid inputs and cursors, and requires configured auth', async () => {
      for (const query of ['linkId=nope', 'color=red', 'hasNote=maybe', 'limit=abc']) {
        const res = await send('GET', `/api/highlights?${query}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'validation_error' });
      }
      const bad = await send('GET', '/api/highlights?cursor=bad');
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ error: 'invalid_cursor' });
      vi.stubEnv('SILO_API_TOKEN', 'reader-test-token');
      try {
        expect((await send('GET', '/api/highlights')).status).toBe(401);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
