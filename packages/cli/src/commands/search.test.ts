import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../client.js';
import type { SearchResultJson } from '../types.js';
import { runSearch } from './search.js';

function resultFixture(overrides: Partial<SearchResultJson> = {}): SearchResultJson {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    url: 'https://example.com',
    title: 'Example',
    description: null,
    imageUrl: null,
    siteName: null,
    extractedText: null,
    sourceKind: 'link',
    sourceData: { kind: 'link' },
    captureStatus: 'full',
    addedBy: 'user',
    notes: null,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    rank: 0.9,
    ...overrides,
  };
}

describe('runSearch', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints a formatted line per result', async () => {
    const search = vi.fn().mockResolvedValue({ results: [resultFixture()] });
    const client = { search } as unknown as Client;

    await runSearch(client, { query: 'foo', json: false });

    expect(search).toHaveBeenCalledWith('foo');
    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('Example');
  });

  it('prints a "no results" message for an empty result set', async () => {
    const search = vi.fn().mockResolvedValue({ results: [] });
    const client = { search } as unknown as Client;

    await runSearch(client, { query: 'nothing-matches', json: false });

    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('No results');
  });

  it('emits raw JSON with --json', async () => {
    const results = [resultFixture()];
    const search = vi.fn().mockResolvedValue({ results });
    const client = { search } as unknown as Client;

    await runSearch(client, { query: 'foo', json: true });

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ results }));
  });
});
