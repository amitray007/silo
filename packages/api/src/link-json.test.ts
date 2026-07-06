import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from './test-support/pg-harness.js';

/**
 * Integration tests for the API-local link shaper (`link-json.ts`) against a
 * real Postgres (see `docs/rules/testing.md`) — a real `LinkWithTags` from
 * `core.createLink`/`getById`/`softDelete` gives the leak-guard test fidelity
 * (asserting against the actual shape `core` returns, not a hand-typed
 * stand-in that could drift from it).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

/**
 * Asserts the internal-only fields never appear as own-keys on a shaped JSON
 * object — the leak guard shared by every shaper variant's test.
 * `sourceData` is DELIBERATELY NOT in this list (source-data/rich-previews
 * slice, plan 012 un-blocked it — see `link-json.ts`'s doc comment): it's
 * now a whitelisted, display-only field. Its own presence/shape is asserted
 * positively in the tests below instead of being guarded against here.
 */
function expectNoLeakedFields(json: object): void {
  expect(Object.hasOwn(json, 'searchVector')).toBe(false);
  expect(Object.hasOwn(json, 'canonicalUrl')).toBe(false);
}

describeIfPg('link-json (integration)', () => {
  const harness = setupPgHarness('silo_api_link_json_test', async () => {
    return (await import('@silo/core')) as typeof CoreOps;
  });

  it('toLinkJson whitelists exactly the expected fields — no internal-field leak', async () => {
    const core = harness.mod();
    const { toLinkJson } = await import('./link-json.js');

    const created = await core.createLink({
      url: 'https://example.com/link-json-happy-path',
      title: 'A title',
      description: 'A description',
      sourceKind: 'link',
      tags: ['alpha', 'beta'],
      notes: 'a note',
      origin: 'agent',
    });
    const link = await core.getById(created.id);
    expect(link).not.toBeNull();
    if (!link) return;

    const json = toLinkJson(link);

    // Whitelisted fields present, with the right shapes.
    expect(json.id).toBe(link.id);
    expect(json.url).toBe(link.url);
    expect(json.title).toBe('A title');
    expect(json.description).toBe('A description');
    expect(json.sourceKind).toBe('link');
    expect(json.captureStatus).toBe('enriching');
    expect(json.addedBy).toBe('agent');
    expect(json.notes).toBe('a note');
    expect(json.tags.slice().sort()).toEqual(['alpha', 'beta']);
    expect(json.sourceData).toEqual({ kind: 'link' });
    expect(typeof json.createdAt).toBe('string');
    expect(typeof json.updatedAt).toBe('string');
    // ISO 8601 round-trips through Date without throwing/NaN.
    expect(Number.isNaN(new Date(json.createdAt).getTime())).toBe(false);
    expect(Number.isNaN(new Date(json.updatedAt).getTime())).toBe(false);

    // The leak guard: internal-only fields must be structurally absent from
    // the JSON object, not merely undefined — `toLinkJson` builds the result
    // via explicit field-by-field construction, so these keys shouldn't exist.
    expectNoLeakedFields(json);
    expect(Object.hasOwn(json, 'deletedAt')).toBe(false);
  });

  it('toTrashLinkJson adds deletedAt as an ISO string for a trashed link', async () => {
    const core = harness.mod();
    const { toTrashLinkJson } = await import('./link-json.js');

    const created = await core.createLink({
      url: 'https://example.com/link-json-trash-path',
      sourceKind: 'link',
    });
    await core.softDelete(created.id);
    const { links: trashed } = await core.listTrash();
    const trashedLink = trashed.find((l) => l.id === created.id);
    expect(trashedLink).toBeDefined();
    if (!trashedLink) return;

    const json = toTrashLinkJson(trashedLink);
    expect(typeof json.deletedAt).toBe('string');
    expect(json.deletedAt.length).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(json.deletedAt).getTime())).toBe(false);
    // Still no internal-field leak on the trash variant.
    expectNoLeakedFields(json);
  });

  it('toLinkJson shapes a real, validated non-link sourceData payload through', async () => {
    const core = harness.mod();
    const { toLinkJson } = await import('./link-json.js');

    const created = await core.createLink({
      url: 'https://news.ycombinator.com/item?id=424242',
      sourceKind: 'hacker_news',
      sourceData: { kind: 'hacker_news', points: 250, comments: 84, author: 'pg' },
    });
    const link = await core.getById(created.id);
    expect(link).not.toBeNull();
    if (!link) return;

    const json = toLinkJson(link);
    expect(json.sourceKind).toBe('hacker_news');
    expect(json.sourceData).toEqual({
      kind: 'hacker_news',
      points: 250,
      comments: 84,
      author: 'pg',
    });
  });

  it('toLinkJson falls back to the safe link floor for a malformed/corrupted stored source_data (defense in depth)', async () => {
    const core = harness.mod();
    const { toLinkJson } = await import('./link-json.js');
    const { db } = await import('@silo/db');
    const { sql } = await import('drizzle-orm');

    const created = await core.createLink({
      url: 'https://example.com/link-json-corrupted-source-data',
      sourceKind: 'link',
    });
    // Bypass core's write-boundary validation entirely (raw SQL) to simulate
    // a hand-edited row / pre-migration drift — something `toLinkJson` must
    // never propagate into an HTTP response as a thrown error.
    await db.execute(
      sql`update links set source_data = '{"kind":"hacker_news","points":"not-a-number"}' where id = ${created.id}`,
    );
    const link = await core.getById(created.id);
    expect(link).not.toBeNull();
    if (!link) return;

    const json = toLinkJson(link);
    expect(json.sourceData).toEqual({ kind: 'link' });
  });

  it('toSearchResultJson carries the whitelist plus rank', async () => {
    const core = harness.mod();
    const { toSearchResultJson } = await import('./link-json.js');

    const created = await core.createLink({
      url: 'https://example.com/link-json-search-path',
      sourceKind: 'link',
    });
    const link = await core.getById(created.id);
    expect(link).not.toBeNull();
    if (!link) return;

    const json = toSearchResultJson(link, 0.42);
    expect(json.rank).toBe(0.42);
    expect(json.id).toBe(link.id);
  });

  it('toTrashSearchResultJson carries the whitelist plus rank AND deletedAt (Trash search slice)', async () => {
    const core = harness.mod();
    const { toTrashSearchResultJson } = await import('./link-json.js');

    const created = await core.createLink({
      url: 'https://example.com/link-json-trash-search-path',
      sourceKind: 'link',
    });
    await core.softDelete(created.id);
    const { links: trashed } = await core.listTrash();
    const trashedLink = trashed.find((l) => l.id === created.id);
    expect(trashedLink).toBeDefined();
    if (!trashedLink) return;

    const json = toTrashSearchResultJson(trashedLink, 0.42);
    expect(json.rank).toBe(0.42);
    expect(json.id).toBe(trashedLink.id);
    expect(typeof json.deletedAt).toBe('string');
    expect(json.deletedAt.length).toBeGreaterThan(0);
    expectNoLeakedFields(json);
  });
});
