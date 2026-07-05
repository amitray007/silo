import { describe, expect, it } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { enrichYouTube, youtubeThumbnailUrl } from './youtube.js';

function okResult(body: unknown): SafeFetchResult {
  return {
    ok: true,
    html: JSON.stringify(body),
    contentType: 'application/json',
    finalUrl: 'https://www.youtube.com/oembed?url=...',
    status: 200,
  };
}

describe('youtubeThumbnailUrl', () => {
  it('builds the deterministic hqdefault thumbnail url', () => {
    expect(youtubeThumbnailUrl('dQw4w9WgXcQ')).toBe(
      'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
  });
});

describe('enrichYouTube', () => {
  it('maps a valid oEmbed response to youtube SourceData', async () => {
    const result = await enrichYouTube('dQw4w9WgXcQ', () =>
      Promise.resolve(okResult({ author_name: 'Rick Astley', title: 'Never Gonna Give You Up' })),
    );
    expect(result).toEqual({
      kind: 'youtube',
      channel: 'Rick Astley',
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  });

  it('degrades to undefined on a safeFetch failure (private/deleted/age-restricted video)', async () => {
    const result = await enrichYouTube('dQw4w9WgXcQ', () =>
      Promise.resolve({ ok: false, reason: 'http-error', detail: '401' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on timeout', async () => {
    const result = await enrichYouTube('dQw4w9WgXcQ', () =>
      Promise.resolve({ ok: false, reason: 'timeout' }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on malformed JSON', async () => {
    const result = await enrichYouTube('dQw4w9WgXcQ', () =>
      Promise.resolve({
        ok: true,
        html: 'not json',
        contentType: 'application/json',
        finalUrl: 'https://www.youtube.com/oembed',
        status: 200,
      }),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined when author_name is missing', async () => {
    const result = await enrichYouTube('dQw4w9WgXcQ', () =>
      Promise.resolve(okResult({ title: 'x' })),
    );
    expect(result).toBeUndefined();
  });

  it('degrades to undefined on a non-object JSON body', async () => {
    const result = await enrichYouTube('dQw4w9WgXcQ', () => Promise.resolve(okResult(42)));
    expect(result).toBeUndefined();
  });

  it('URL-encodes the video id into the oembed request', async () => {
    let calledUrl: string | undefined;
    await enrichYouTube('abc def', (url) => {
      calledUrl = url;
      return Promise.resolve(okResult({ author_name: 'x' }));
    });
    expect(calledUrl).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc%2520def&format=json',
    );
  });
});
