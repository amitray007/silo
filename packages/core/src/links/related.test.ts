import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as LinksOps from './links.js';
import type * as RelatedOps from './related.js';

/**
 * Integration tests for `findRelated` (agent-navigation slice U3) against a
 * real Postgres (see docs/rules/testing.md) — full-text ranking and tag
 * overlap are database-level behaviors mocks can't prove.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('findRelated (integration, U3)', () => {
  const harness = setupPgHarness('silo_core_related_test', async () => {
    const links = await import('./links.js');
    const related = await import('./related.js');
    return { ...links, ...related };
  });
  let ops: typeof LinksOps & typeof RelatedOps;

  beforeEach(() => {
    ops = harness.mod();
  });

  it('returns other links sharing the seed tags, ranked, and EXCLUDES the seed', async () => {
    const seed = await ops.createLink({
      url: 'https://example.com/related-seed',
      sourceKind: 'link',
      title: 'Introduction to Rust ownership',
      tags: ['rust', 'programming'],
    });
    const sameTagBoth = await ops.createLink({
      url: 'https://example.com/related-both-tags',
      sourceKind: 'link',
      title: 'Something else entirely',
      tags: ['rust', 'programming'],
    });
    const sameTagOne = await ops.createLink({
      url: 'https://example.com/related-one-tag',
      sourceKind: 'link',
      title: 'Another unrelated title',
      tags: ['rust'],
    });
    const unrelated = await ops.createLink({
      url: 'https://example.com/related-unrelated',
      sourceKind: 'link',
      title: 'Baking sourdough bread at home',
      tags: ['cooking'],
    });

    const results = await ops.findRelated(seed.id);
    const resultIds = results.map((r) => r.id);

    expect(resultIds).not.toContain(seed.id);
    expect(resultIds).toContain(sameTagBoth.id);
    expect(resultIds).toContain(sameTagOne.id);
    expect(resultIds).not.toContain(unrelated.id);

    // Ranked by overlap: the link sharing BOTH tags should rank at or above
    // the link sharing only one (search's ts_rank sums matched-term weight).
    const bothIndex = resultIds.indexOf(sameTagBoth.id);
    const oneIndex = resultIds.indexOf(sameTagOne.id);
    expect(bothIndex).toBeLessThanOrEqual(oneIndex);
  });

  it('matches on significant title terms when tags are absent', async () => {
    const seed = await ops.createLink({
      url: 'https://example.com/related-title-seed',
      sourceKind: 'link',
      title: 'Distributed systems consensus algorithms',
    });
    const titleMatch = await ops.createLink({
      url: 'https://example.com/related-title-match',
      sourceKind: 'link',
      title: 'A deep dive into consensus algorithms',
    });
    const unrelated = await ops.createLink({
      url: 'https://example.com/related-title-unrelated',
      sourceKind: 'link',
      title: 'A recipe for chocolate cake',
    });

    const results = await ops.findRelated(seed.id);
    const resultIds = results.map((r) => r.id);

    expect(resultIds).toContain(titleMatch.id);
    expect(resultIds).not.toContain(unrelated.id);
    expect(resultIds).not.toContain(seed.id);
  });

  it('seed not found (unknown id) returns an empty array', async () => {
    const results = await ops.findRelated('00000000-0000-4000-8000-000000000000');
    expect(results).toEqual([]);
  });

  it('seed with no tags and no significant title terms returns an empty array', async () => {
    const seed = await ops.createLink({
      url: 'https://example.com/related-no-signal',
      sourceKind: 'link',
      title: 'a  ',
    });

    const results = await ops.findRelated(seed.id);
    expect(results).toEqual([]);
  });

  it('a trashed seed (getById is live-scoped) returns an empty array', async () => {
    const seed = await ops.createLink({
      url: 'https://example.com/related-trashed-seed',
      sourceKind: 'link',
      title: 'Some trashed article about kubernetes',
      tags: ['kubernetes'],
    });
    await ops.softDelete(seed.id);

    const results = await ops.findRelated(seed.id);
    expect(results).toEqual([]);
  });

  it('respects the limit param', async () => {
    const seed = await ops.createLink({
      url: 'https://example.com/related-limit-seed',
      sourceKind: 'link',
      title: 'Machine learning fundamentals',
      tags: ['ml'],
    });
    for (let i = 0; i < 5; i++) {
      await ops.createLink({
        url: `https://example.com/related-limit-${i}`,
        sourceKind: 'link',
        title: `Machine learning topic ${i}`,
        tags: ['ml'],
      });
    }

    const results = await ops.findRelated(seed.id, 2);
    expect(results).toHaveLength(2);
  });

  it('HIGH-finding regression: a stopword title term does NOT trigram-flood unrelated substring matches', async () => {
    // Before the ftsOnly fix, findRelated's per-term search ran through the
    // full union path, whose trigram substring side is always-on and NOT
    // stopword-aware: the seed's title term 'the' would issue an unfiltered
    // `ILIKE '%the%'`, matching ANY row containing that substring anywhere
    // (e.g. 'wEATHEr', 'togeTHEr') regardless of topical relevance. FTS-only
    // matching empties out a pure-stopword term instead (to_tsquery('english',
    // 'the') has no lexemes), so it contributes zero candidates for 'the' —
    // the unrelated row must never appear via that noise.
    const seed = await ops.createLink({
      url: 'https://example.com/related-stopword-seed',
      sourceKind: 'link',
      title: 'The State of the Art and You',
      tags: ['distributedsystems'],
    });
    const unrelatedSubstringOnly = await ops.createLink({
      url: 'https://example.com/related-stopword-unrelated',
      sourceKind: 'link',
      title: 'Weather forecasting basics',
    });

    const results = await ops.findRelated(seed.id);
    const resultIds = results.map((r) => r.id);

    expect(resultIds).not.toContain(unrelatedSubstringOnly.id);
    expect(resultIds).not.toContain(seed.id);
  });

  it('MEDIUM-finding regression: a high-overlap candidate outranks a single-term match even from a deep per-term window', async () => {
    // Construct a seed with enough terms (tags + title words) that a shallow
    // per-term fetch window (the old `effectiveLimit + 1`) would bury the
    // high-overlap candidate below many single-term-only decoys ranked ahead
    // of it within any ONE term's individual result set. The deepened
    // `PER_TERM_FETCH` (`min(effectiveLimit*5, 100)`) window must still
    // surface it, and matchCount-first ranking must put it above a
    // single-term match.
    const seed = await ops.createLink({
      url: 'https://example.com/related-overlap-seed',
      sourceKind: 'link',
      title: 'Kubernetes networking deep dive',
      tags: ['kubernetes', 'networking', 'deepdive'],
    });
    const highOverlap = await ops.createLink({
      url: 'https://example.com/related-overlap-high',
      sourceKind: 'link',
      title: 'An unrelated headline entirely',
      tags: ['kubernetes', 'networking', 'deepdive'],
    });
    const singleTermMatch = await ops.createLink({
      url: 'https://example.com/related-overlap-single',
      sourceKind: 'link',
      title: 'Just about networking alone',
      tags: ['networking'],
    });
    // Decoys ranked ahead of `highOverlap` within EACH single term's result
    // set (created after `highOverlap`, so `links.id ASC`'s tiebreak alone
    // wouldn't explain it — these share tags/rank comparably per-term, and
    // a shallow effectiveLimit+1 window per term risks pushing `highOverlap`
    // out before its cross-term overlap is ever counted).
    for (let i = 0; i < 3; i++) {
      await ops.createLink({
        url: `https://example.com/related-overlap-decoy-kubernetes-${i}`,
        sourceKind: 'link',
        title: `Kubernetes decoy ${i}`,
        tags: ['kubernetes'],
      });
      await ops.createLink({
        url: `https://example.com/related-overlap-decoy-networking-${i}`,
        sourceKind: 'link',
        title: `Networking decoy ${i}`,
        tags: ['networking'],
      });
      await ops.createLink({
        url: `https://example.com/related-overlap-decoy-deepdive-${i}`,
        sourceKind: 'link',
        title: `Deepdive decoy ${i}`,
        tags: ['deepdive'],
      });
    }

    const results = await ops.findRelated(seed.id, 3);
    const resultIds = results.map((r) => r.id);

    expect(resultIds).toContain(highOverlap.id);
    const highOverlapIndex = resultIds.indexOf(highOverlap.id);
    const singleTermIndex = resultIds.indexOf(singleTermMatch.id);
    if (singleTermIndex !== -1) {
      expect(highOverlapIndex).toBeLessThan(singleTermIndex);
    }
  });

  it('returns snippet + rank fields, matching the search() result shape', async () => {
    const seed = await ops.createLink({
      url: 'https://example.com/related-shape-seed',
      sourceKind: 'link',
      title: 'Quantum computing basics',
      tags: ['quantum'],
    });
    await ops.createLink({
      url: 'https://example.com/related-shape-other',
      sourceKind: 'link',
      title: 'More quantum computing content',
      tags: ['quantum'],
    });

    const [result] = await ops.findRelated(seed.id);
    expect(result).toMatchObject({
      id: expect.any(String),
      rank: expect.any(Number),
      snippet: expect.anything(),
    });
    expect(result && 'extractedText' in result).toBe(false);
  });
});
