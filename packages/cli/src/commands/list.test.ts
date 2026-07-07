import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../client.js';
import type { LinkJson } from '../types.js';
import { runList } from './list.js';

function linkFixture(id: string, createdAt: string): LinkJson {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
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
    createdAt,
    updatedAt: createdAt,
  };
}

describe('runList', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('fetches one page when no limit is given and prints day-grouped output', async () => {
    const list = vi.fn().mockResolvedValue({
      links: [linkFixture('a', new Date().toISOString())],
    });
    const client = { list } as unknown as Client;

    await runList(client, { json: false });

    expect(list).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('Today');
  });

  it('paginates across multiple pages until the limit is reached', async () => {
    const page1 = {
      links: Array.from({ length: 100 }, (_, i) =>
        linkFixture(`p1-${i}`, new Date().toISOString()),
      ),
      nextCursor: 'cursor-1',
    };
    const page2 = {
      links: Array.from({ length: 100 }, (_, i) =>
        linkFixture(`p2-${i}`, new Date().toISOString()),
      ),
    };
    const list = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const client = { list } as unknown as Client;

    await runList(client, { limit: 150, json: true });

    expect(list).toHaveBeenCalledTimes(2);
    const printed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(printed.links.length).toBe(150);
  });

  it('stops paginating once nextCursor is absent even under the limit', async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ links: [linkFixture('only', new Date().toISOString())] });
    const client = { list } as unknown as Client;

    await runList(client, { limit: 500, json: true });

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('passes the tag filter through to every page request', async () => {
    const list = vi.fn().mockResolvedValue({ links: [] });
    const client = { list } as unknown as Client;

    await runList(client, { tag: 'ai', json: true });

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ tag: 'ai' }));
  });

  it('prints a tag-specific empty message', async () => {
    const list = vi.fn().mockResolvedValue({ links: [] });
    const client = { list } as unknown as Client;

    await runList(client, { tag: 'nonexistent', json: false });

    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('nonexistent');
  });
});
