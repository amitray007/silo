import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('findSavedUrls (disposable Postgres)', () => {
  const harness = setupPgHarness('silo_core_saved_test', async () => ({
    ...(await import('./links.js')),
    ...(await import('./saved.js')),
  }));

  it('returns original inputs in order for canonical live matches', async () => {
    const ops = harness.mod();
    await ops.createLink({ url: 'https://example.com/path?a=1&b=2', sourceKind: 'link' });
    const variant = 'http://www.example.com/path/?b=2&utm_source=reader&a=1#section';
    const exact = 'https://example.com/path?a=1&b=2';
    expect(await ops.findSavedUrls([variant, 'https://unsaved.test', exact])).toEqual([
      variant,
      exact,
    ]);
  });

  it('excludes trashed links while retaining a live match', async () => {
    const ops = harness.mod();
    const trashed = await ops.createLink({ url: 'https://example.com/trash', sourceKind: 'link' });
    await ops.softDelete(trashed.id);
    await ops.createLink({ url: 'https://example.com/live', sourceKind: 'link' });
    expect(
      await ops.findSavedUrls(['https://example.com/trash', 'https://example.com/live']),
    ).toEqual(['https://example.com/live']);
  });

  it('bounds lookup to the first 50 inputs', async () => {
    const ops = harness.mod();
    await ops.createLink({ url: 'https://example.com/0', sourceKind: 'link' });
    await ops.createLink({ url: 'https://example.com/50', sourceKind: 'link' });
    expect(
      await ops.findSavedUrls(Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`)),
    ).toEqual(['https://example.com/0']);
  });

  it('returns no matches for empty or unsafe input', async () => {
    const ops = harness.mod();
    await ops.createLink({ url: 'javascript:alert(1)', sourceKind: 'link' });
    expect(await ops.findSavedUrls([])).toEqual([]);
    expect(await ops.findSavedUrls(['javascript:alert(1)', 'https://[bad'])).toEqual([]);
  });
});
