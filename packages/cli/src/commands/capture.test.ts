import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../client.js';
import type { LinkJson } from '../types.js';
import { runCapture } from './capture.js';

function linkFixture(overrides: Partial<LinkJson> = {}): LinkJson {
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
    captureStatus: 'enriching',
    addedBy: 'user',
    source: 'unknown',
    notes: null,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('runCapture', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('captures with note + tags and prints the result', async () => {
    const capture = vi.fn().mockResolvedValue({ link: linkFixture(), deduped: false });
    const client = { capture } as unknown as Client;

    await runCapture(client, {
      url: 'https://example.com',
      note: 'my note',
      tags: ['a', 'b'],
      wait: false,
      json: false,
    });

    expect(capture).toHaveBeenCalledWith({
      url: 'https://example.com',
      note: 'my note',
      tags: ['a', 'b'],
    });
    expect(logSpy).toHaveBeenCalled();
  });

  it('omits note/tags from the body when not given', async () => {
    const capture = vi.fn().mockResolvedValue({ link: linkFixture(), deduped: false });
    const client = { capture } as unknown as Client;

    await runCapture(client, { url: 'https://example.com', tags: [], wait: false, json: false });

    expect(capture).toHaveBeenCalledWith({ url: 'https://example.com' });
  });

  it('prints "already saved" wording on dedup', async () => {
    const capture = vi
      .fn()
      .mockResolvedValue({ link: linkFixture({ captureStatus: 'full' }), deduped: true });
    const client = { capture } as unknown as Client;

    await runCapture(client, { url: 'https://example.com', tags: [], wait: false, json: false });

    const printed = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(printed).toContain('already saved');
  });

  it('emits raw JSON with --json', async () => {
    const link = linkFixture();
    const capture = vi.fn().mockResolvedValue({ link, deduped: false });
    const client = { capture } as unknown as Client;

    await runCapture(client, { url: 'https://example.com', tags: [], wait: false, json: true });

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ link, deduped: false }));
  });

  it('--wait polls getById until captureStatus leaves enriching', async () => {
    const capture = vi
      .fn()
      .mockResolvedValue({ link: linkFixture({ captureStatus: 'enriching' }), deduped: false });
    const getById = vi
      .fn()
      .mockResolvedValueOnce({ link: linkFixture({ captureStatus: 'enriching' }) })
      .mockResolvedValueOnce({ link: linkFixture({ captureStatus: 'full', title: 'Enriched' }) });
    const client = { capture, getById } as unknown as Client;

    await runCapture(client, {
      url: 'https://example.com',
      tags: [],
      wait: true,
      json: true,
    });

    expect(getById).toHaveBeenCalled();
    const lastCall = logSpy.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(lastCall).link.captureStatus).toBe('full');
  });

  it('--wait does not poll when the capture deduped (nothing new is enriching)', async () => {
    const capture = vi
      .fn()
      .mockResolvedValue({ link: linkFixture({ captureStatus: 'full' }), deduped: true });
    const getById = vi.fn();
    const client = { capture, getById } as unknown as Client;

    await runCapture(client, { url: 'https://example.com', tags: [], wait: true, json: true });

    expect(getById).not.toHaveBeenCalled();
  });
});
