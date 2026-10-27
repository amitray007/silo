import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLive, setLiveReader } from './live-reader.js';

const link = { id: 'a', url: 'https://example.org/a', sourceKind: 'link' };
const content = { contentHtml: '<p>Live</p>', contentImages: [] };

describe('live reader port', () => {
  afterEach(() => setLiveReader(undefined));

  it('returns undefined when no reader is registered', async () => {
    expect(await readLive(link, new AbortController().signal)).toBeUndefined();
  });

  it('passes the link and the caller signal to the registered reader', async () => {
    const reader = vi.fn(async () => content);
    setLiveReader(reader);
    const signal = new AbortController().signal;
    expect(await readLive(link, signal)).toEqual(content);
    expect(reader).toHaveBeenCalledWith(link, signal);
  });

  it('stops reading once the reader is unregistered', async () => {
    setLiveReader(async () => content);
    setLiveReader(undefined);
    expect(await readLive(link, new AbortController().signal)).toBeUndefined();
  });
});
