import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for the reading-position routes against a real
 * Postgres: `PUT`/`DELETE /api/links/:id/reading-position` and the field on the
 * single-link read.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

type Position = { position: number; source: string; updatedAt: string };

describeIfPg('reading position routes (integration)', () => {
  const harness = setupPgHarness('silo_api_reading_position_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    const { pool } = await import('@silo/db');
    return { core, app: createApp(), pool };
  });

  async function newLinkId(url: string): Promise<string> {
    const { core } = harness.mod();
    return (await core.createLink({ url, sourceKind: 'link' })).id;
  }

  async function put(path: string, body: unknown): Promise<Response> {
    return harness.mod().app.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function readLink(id: string): Promise<{ readingPosition: Position | null }> {
    const res = await harness.mod().app.request(`/api/links/${id}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { link: { readingPosition: Position | null } }).link;
  }

  it('GET /api/links/:id carries readingPosition: null before anything is saved', async () => {
    const id = await newLinkId('https://example.com/rp-null');
    expect((await readLink(id)).readingPosition).toBeNull();
  });

  it('PUT saves, returns the position, and GET shows it', async () => {
    const id = await newLinkId('https://example.com/rp-put');
    const res = await put(`/api/links/${id}/reading-position`, { position: 0.4 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { readingPosition: Position };
    expect(body.readingPosition.source).toBe('mark');
    expect(Object.keys(body.readingPosition).sort()).toEqual(['position', 'source', 'updatedAt']);
    expect(body.readingPosition.position).toBeCloseTo(0.4);
    expect(Number.isNaN(Date.parse(body.readingPosition.updatedAt))).toBe(false);
    expect((await readLink(id)).readingPosition?.position).toBeCloseTo(0.4);
  });

  it.each(['pencil', 'listen', 'mark'])('round-trips source %s', async (source) => {
    const id = await newLinkId(`https://example.com/source-${source}`);
    const res = await put(`/api/links/${id}/reading-position`, { position: 0.5, source });
    expect(res.status).toBe(200);
    expect((await readLink(id)).readingPosition?.source).toBe(source);
  });

  it('PUT overwrites', async () => {
    const id = await newLinkId('https://example.com/rp-overwrite');
    await put(`/api/links/${id}/reading-position`, { position: 0.1 });
    await put(`/api/links/${id}/reading-position`, { position: 0.9 });
    expect((await readLink(id)).readingPosition?.position).toBeCloseTo(0.9);
  });

  it('ignores stale client timestamps, including a late pre-pagehide PUT', async () => {
    const id = await newLinkId('https://example.com/rp-write-order');
    const path = `/api/links/${id}/reading-position`;
    // Past timestamps: the server clamps anything ahead of its clock to now.
    const base = Date.now() - 60_000;
    const at = (ms: number) => new Date(base + ms).toISOString();
    const newer = { position: 0.9, source: 'listen', writtenAt: at(1) };
    expect((await put(path, newer)).status).toBe(200);
    const stale = await put(path, {
      position: 0.1,
      source: 'pencil',
      writtenAt: at(0),
    });
    expect(stale.status).toBe(200);
    expect(
      ((await stale.json()) as { readingPosition: Position }).readingPosition.position,
    ).toBeCloseTo(0.9);
    expect((await readLink(id)).readingPosition?.source).toBe('listen');
    expect((await readLink(id)).readingPosition?.updatedAt).toBe(newer.writtenAt);
    expect((await put(path, { ...newer, position: 0.2 })).status).toBe(200);
    expect((await readLink(id)).readingPosition?.position).toBeCloseTo(0.9);
    expect((await put(path, { ...newer, position: 0.7, writtenAt: at(2) })).status).toBe(200);
    expect((await readLink(id)).readingPosition?.position).toBeCloseTo(0.7);
  });

  it('PATCH edits keep returning the position', async () => {
    const id = await newLinkId('https://example.com/rp-patch');
    await put(`/api/links/${id}/reading-position`, { position: 0.3 });
    const res = await harness.mod().app.request(`/api/links/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Edited' }),
    });
    const body = (await res.json()) as { link: { readingPosition: Position | null } };
    expect(body.link.readingPosition?.position).toBeCloseTo(0.3);
  });

  it.each([
    ['above one', { position: 1.5 }],
    ['below zero', { position: -0.2 }],
    ['a string', { position: 'half' }],
    ['missing', {}],
    ['null', { position: null }],
    ['bad source', { position: 0.5, source: 'scroll' }],
    ['null source', { position: 0.5, source: null }],
    ['invalid timestamp', { position: 0.5, writtenAt: 'yesterday' }],
  ])('PUT rejects %s with 400', async (_name, body) => {
    const id = await newLinkId(`https://example.com/rp-bad-${_name.replace(/\W/g, '')}`);
    const res = await put(`/api/links/${id}/reading-position`, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorEnvelope).error).toBe('validation_error');
    expect((await readLink(id)).readingPosition).toBeNull();
  });

  it('PUT rejects a malformed id with 400 and an unknown id with 404', async () => {
    expect((await put('/api/links/not-a-uuid/reading-position', { position: 0.5 })).status).toBe(
      400,
    );
    const res = await put('/api/links/11111111-1111-4111-8111-111111111111/reading-position', {
      position: 0.5,
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorEnvelope).error).toBe('not_found');
  });

  it('PUT and DELETE return 404 for a trashed link', async () => {
    const { core, app } = harness.mod();
    const id = await newLinkId('https://example.com/rp-trashed');
    await core.softDelete(id);
    expect((await put(`/api/links/${id}/reading-position`, { position: 0.5 })).status).toBe(404);
    const del = await app.request(`/api/links/${id}/reading-position`, { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('DELETE clears with 204, and clearing again is still 204', async () => {
    const { app } = harness.mod();
    const id = await newLinkId('https://example.com/rp-delete');
    await put(`/api/links/${id}/reading-position`, { position: 0.5 });
    const first = await app.request(`/api/links/${id}/reading-position`, { method: 'DELETE' });
    expect(first.status).toBe(204);
    expect((await readLink(id)).readingPosition).toBeNull();
    const second = await app.request(`/api/links/${id}/reading-position`, { method: 'DELETE' });
    expect(second.status).toBe(204);
  });

  it('DELETE on a feed post -> 409, and PUT too', async () => {
    const { pool, app } = harness.mod();
    const feed = await pool.query<{ id: string }>(
      "insert into feeds (feed_url, title, format, next_poll_at) values ('https://f.test/x', 'F', 'rss', now()) returning id",
    );
    const post = await pool.query<{ id: string }>(
      "insert into links (url, canonical_url, source_kind, feed_id) values ('https://f.test/p', 'https://f.test/p', 'link', $1) returning id",
      [feed.rows[0]?.id],
    );
    const id = post.rows[0]?.id ?? '';
    const del = await app.request(`/api/links/${id}/reading-position`, { method: 'DELETE' });
    expect(del.status).toBe(409);
    expect(((await del.json()) as ErrorEnvelope).error).toBe('feed_post_not_editable');
    expect((await put(`/api/links/${id}/reading-position`, { position: 0.5 })).status).toBe(409);
  });

  it('list responses do not carry readingPosition', async () => {
    const id = await newLinkId('https://example.com/rp-list');
    await put(`/api/links/${id}/reading-position`, { position: 0.5 });
    const res = await harness.mod().app.request('/api/links');
    const body = (await res.json()) as { links: Array<Record<string, unknown>> };
    expect(body.links.length).toBeGreaterThan(0);
    for (const row of body.links) expect(Object.hasOwn(row, 'readingPosition')).toBe(false);
  });
  describe('GET /api/reading-positions', () => {
    beforeEach(async () => {
      await harness.mod().pool.query('truncate links, feeds cascade');
    });

    it('filters each source and pages newest updates first', async () => {
      const { core, app, pool } = harness.mod();
      const ids: string[] = [];
      for (const [index, source] of (['pencil', 'listen', 'mark'] as const).entries()) {
        const id = await newLinkId(`https://example.com/list-${source}`);
        ids.push(id);
        await core.setReadingPosition(id, 0.5, source);
        await pool.query(
          "update reading_positions set updated_at = '2026-01-01'::timestamptz + ($2 || ' seconds')::interval where link_id=$1",
          [id, String(index)],
        );
        const res = await app.request(`/api/reading-positions?source=${source}`);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          positions: [{ link: { id }, source, position: 0.5, updatedAt: expect.any(String) }],
        });
      }
      const first = (await (await app.request('/api/reading-positions?limit=2')).json()) as {
        positions: Array<{ link: { id: string } }>;
        nextCursor: string;
      };
      const second = (await (
        await app.request(`/api/reading-positions?cursor=${first.nextCursor}`)
      ).json()) as { positions: Array<{ link: { id: string } }>; nextCursor?: string };
      expect([...first.positions, ...second.positions].map((r) => r.link.id)).toEqual(
        ids.reverse(),
      );
      expect(second.nextCursor).toBeUndefined();
      expect(Object.keys(first.positions[0] ?? {}).sort()).toEqual([
        'link',
        'position',
        'source',
        'updatedAt',
      ]);
    });

    it('defaults to 20, caps at 100 and excludes trash and feed posts', async () => {
      const { core, pool, app } = harness.mod();
      await pool.query(`with l as (
        insert into links (url,canonical_url,source_kind) select 'https://example.com/'||n,'https://example.com/'||n,'link' from generate_series(1,105) n returning id
      ) insert into reading_positions (link_id,position,source) select id,0.5,'mark' from l`);
      const trashed = await newLinkId('https://example.com/trash-position');
      await core.setReadingPosition(trashed, 0.5);
      await core.softDelete(trashed);
      await pool.query(`with f as (
        insert into feeds (feed_url,title,format,next_poll_at) values ('https://f.test/list','F','rss',now()) returning id
      ), p as (insert into links (url,canonical_url,source_kind,feed_id) select 'https://f.test/list-post','https://f.test/list-post','link',id from f returning id)
      insert into reading_positions (link_id,position,source) select id,0.5,'listen' from p`);
      const read = async (q: string) =>
        (await (await app.request(`/api/reading-positions${q}`)).json()) as {
          positions: Array<{ link: { id: string; url: string } }>;
          nextCursor?: string;
        };
      expect((await read('')).positions).toHaveLength(20);
      const first = await read('?limit=999');
      const second = await read(`?cursor=${first.nextCursor}&limit=100`);
      expect(first.positions).toHaveLength(100);
      const rows = [...first.positions, ...second.positions];
      expect(rows).toHaveLength(105);
      expect(new Set(rows.map((r) => r.link.id)).size).toBe(105);
      expect(
        rows.every((r) => r.link.url.startsWith('https://example.com/') && r.link.id !== trashed),
      ).toBe(true);
    });

    it('maps validation and cursor errors and requires configured auth', async () => {
      const { app } = harness.mod();
      for (const q of ['source=scroll', 'limit=abc']) {
        const res = await app.request(`/api/reading-positions?${q}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'validation_error' });
      }
      const res = await app.request('/api/reading-positions?cursor=bad');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_cursor' });
      vi.stubEnv('SILO_API_TOKEN', 'reader-test-token');
      try {
        expect((await app.request('/api/reading-positions')).status).toBe(401);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
