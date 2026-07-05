import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as LinksOps from './links.js';
import type * as TagsOps from './tags.js';
import type * as TrashOps from './trash.js';

/**
 * Integration tests for `listTagsWithCounts` (plan 007, C3) against a real
 * Postgres (see docs/rules/testing.md) — the grouped join over
 * `tags ⋈ link_tags ⋈ links`, the live-only count, W1 case-fold dedup, and
 * ordering are all database-level behaviors mocks can't prove.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('listTagsWithCounts (integration, C3)', () => {
  const harness = setupPgHarness('silo_core_tags_test', async () => {
    const links = await import('./links.js');
    const trash = await import('./trash.js');
    const tagsMod = await import('./tags.js');
    return { ...links, ...trash, ...tagsMod };
  });
  let ops: typeof LinksOps & typeof TrashOps & typeof TagsOps;

  beforeEach(() => {
    ops = harness.mod();
  });

  /** Find a tag's entry in the full list by name, or undefined if absent. */
  function findTag(list: TagsOps.TagCount[], name: string): TagsOps.TagCount | undefined {
    return list.find((t) => t.name === name);
  }

  it('counts only LIVE links per tag; a link with multiple tags counts toward each', async () => {
    const a = await ops.createLink({
      url: 'https://example.com/tagcount-a',
      tags: ['widgets', 'gadgets'],
      sourceKind: 'link',
    });
    const b = await ops.createLink({
      url: 'https://example.com/tagcount-b',
      tags: ['widgets'],
      sourceKind: 'link',
    });
    const trashed = await ops.createLink({
      url: 'https://example.com/tagcount-trashed',
      tags: ['widgets'],
      sourceKind: 'link',
    });
    await ops.softDelete(trashed.id);

    const list = await ops.listTagsWithCounts();

    expect(findTag(list, 'widgets')?.count).toBe(2);
    expect(findTag(list, 'gadgets')?.count).toBe(1);
    // sanity: both live links exist and are distinct
    expect(a.id).not.toBe(b.id);
  });

  it('W1 case-variants collapse to one tag row: AI/ai count together under the first-entered display name', async () => {
    const first = await ops.createLink({
      url: 'https://example.com/tagcount-case-1',
      tags: ['AI'],
      sourceKind: 'link',
    });
    const second = await ops.createLink({
      url: 'https://example.com/tagcount-case-2',
      tags: ['ai'],
      sourceKind: 'link',
    });

    const list = await ops.listTagsWithCounts();
    const aiEntries = list.filter((t) => t.name.toLowerCase() === 'ai');

    expect(aiEntries).toHaveLength(1);
    expect(aiEntries[0]?.name).toBe('AI'); // first-entered casing wins (see addTagWith)
    expect(aiEntries[0]?.count).toBe(2);
    expect(first.id).not.toBe(second.id);
  });

  it('a name that was never created as a tag does not appear', async () => {
    // A name with no `tags` row at all can't surface regardless of the join —
    // there is nothing to left-join FROM.
    const list = await ops.listTagsWithCounts();
    expect(findTag(list, 'never-created-tag-xyz')).toBeUndefined();
  });

  it('a freshly-created tag with zero live links appears at count 0', async () => {
    // The "+ new tag" flow creates an empty tag; it MUST be visible in the
    // sidebar (count 0) so a link can then be assigned to it. LEFT joins make
    // this work where the old inner join silently hid it.
    const name = await ops.createTag('empty-fresh-tag');
    expect(name).toBe('empty-fresh-tag');
    const list = await ops.listTagsWithCounts();
    expect(findTag(list, 'empty-fresh-tag')?.count).toBe(0);
  });

  it('a tag whose only link is trashed appears at count 0 (not hidden)', async () => {
    const link = await ops.createLink({
      url: 'https://example.com/only-trashed-tag',
      tags: ['ghosttag'],
      sourceKind: 'link',
    });
    await ops.softDelete(link.id);
    const list = await ops.listTagsWithCounts();
    // The tag row still exists; its live count is 0 (the deletedAt filter lives
    // in the join ON clause, so the tag surfaces rather than vanishing).
    expect(findTag(list, 'ghosttag')?.count).toBe(0);
  });

  it("a hard-deleted trashed link does not change a shared tag's live count", async () => {
    const survivor = await ops.createLink({
      url: 'https://example.com/tagcount-harddelete-survivor',
      tags: ['persistent'],
      sourceKind: 'link',
    });
    const doomed = await ops.createLink({
      url: 'https://example.com/tagcount-harddelete-doomed',
      tags: ['persistent'],
      sourceKind: 'link',
    });
    // Trash `doomed` first — its live count contribution is already gone at
    // this point (asserted below), BEFORE hardDelete ever runs.
    await ops.softDelete(doomed.id);
    const afterTrash = await ops.listTagsWithCounts();
    expect(findTag(afterTrash, 'persistent')?.count).toBe(1);

    const deleted = await ops.hardDelete(doomed.id);
    expect(deleted).toBe(true);

    const afterHardDelete = await ops.listTagsWithCounts();
    // The trashed link was never counted as live in the first place (proven
    // above), so hard deleting it doesn't change the tag's live count.
    expect(findTag(afterHardDelete, 'persistent')?.count).toBe(1);
    expect(survivor.id).not.toBe(doomed.id);
  });

  describe('ordering', () => {
    it('orders by count descending, then name ascending for ties', async () => {
      // 'zeta' gets 3 live links, 'alpha' gets 3 live links (tie -> name asc),
      // 'beta' gets 1 live link (lowest).
      for (let i = 0; i < 3; i++) {
        await ops.createLink({
          url: `https://example.com/tagorder-zeta-${i}`,
          tags: ['order-zeta'],
          sourceKind: 'link',
        });
      }
      for (let i = 0; i < 3; i++) {
        await ops.createLink({
          url: `https://example.com/tagorder-alpha-${i}`,
          tags: ['order-alpha'],
          sourceKind: 'link',
        });
      }
      await ops.createLink({
        url: 'https://example.com/tagorder-beta-0',
        tags: ['order-beta'],
        sourceKind: 'link',
      });

      const list = await ops.listTagsWithCounts();
      const relevant = list.filter((t) =>
        ['order-zeta', 'order-alpha', 'order-beta'].includes(t.name),
      );

      expect(relevant.map((t) => t.name)).toEqual(['order-alpha', 'order-zeta', 'order-beta']);
      expect(relevant.map((t) => t.count)).toEqual([3, 3, 1]);
    });
  });

  describe('createTag (C4)', () => {
    it('creates a standalone tag with no link attached — and it appears at count 0', async () => {
      const name = await ops.createTag('standalone');
      expect(name).toBe('standalone');
      // A standalone tag has zero live links but MUST still be listed (count 0)
      // so the "+ new tag" flow surfaces it in the sidebar.
      const listed = await ops.listTagsWithCounts();
      expect(findTag(listed, 'standalone')?.count).toBe(0);
    });

    it('is idempotent and W1 case-insensitive — AI then ai is one tag, first casing kept', async () => {
      const first = await ops.createTag('AI');
      const second = await ops.createTag('ai');
      expect(first).toBe('AI');
      // Re-creating a case-variant returns the CANONICAL (first-entered) display
      // name, never clobbering it — one tag row, display "AI".
      expect(second).toBe('AI');
    });

    it('a blank / whitespace-only name is a no-op returning null', async () => {
      expect(await ops.createTag('   ')).toBeNull();
      expect(await ops.createTag('')).toBeNull();
    });

    it('a created standalone tag is usable as a live filter once a link carries it', async () => {
      await ops.createTag('reading');
      const link = await ops.createLink({
        url: 'https://example.com/createtag-usable',
        tags: ['reading'],
        sourceKind: 'link',
      });
      const listed = await ops.listTagsWithCounts();
      expect(listed.find((t) => t.name === 'reading')?.count).toBe(1);
      // And case-insensitive lookup still finds it (W1).
      const filtered = await ops.list({ tag: 'READING' });
      expect(filtered.links.some((l) => l.id === link.id)).toBe(true);
    });
  });
});
