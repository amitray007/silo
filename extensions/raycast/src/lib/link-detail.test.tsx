import { describe, expect, it } from 'vitest';
import { detailModel } from './link-detail.js';
import type { CapturedLink } from './types.js';

const base = 'http://localhost:8787';

describe('detailModel', () => {
  it('includes a preview image for a youtube link', () => {
    const m = detailModel(
      {
        id: 'v1',
        url: 'https://youtube.com/watch?v=x',
        title: 'V',
        description: null,
        siteName: null,
        sourceKind: 'youtube',
        sourceData: { kind: 'youtube', channel: 'C', thumbnailUrl: 't' },
        captureStatus: 'full',
        notes: null,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    expect(m.imageUrl).toBe('http://localhost:8787/api/preview-image?linkId=v1');
    expect(m.stats.find((s) => s.label === 'Channel')?.value).toBe('C');
  });

  it('omits the image for a youtube link with no stored thumbnail (no broken-image box)', () => {
    const m = detailModel(
      {
        id: 'v2',
        url: 'https://youtube.com/watch?v=y',
        title: 'V2',
        description: null,
        siteName: null,
        sourceKind: 'youtube',
        sourceData: { kind: 'youtube', channel: 'C', thumbnailUrl: '' },
        captureStatus: 'full',
        notes: null,
        tags: [],
        imageUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    expect(m.imageUrl).toBeNull();
  });

  it('omits the image for a media-less tweet (no captured imageUrl)', () => {
    const m = detailModel(
      {
        id: 't1',
        url: 'https://x.com/a/status/1',
        title: 'tweet',
        description: null,
        siteName: null,
        sourceKind: 'twitter',
        sourceData: {
          kind: 'twitter',
          text: 'hi',
          authorHandle: 'a',
          authorName: 'A',
          likes: 0,
          reposts: 0,
          replies: 0,
          quotes: 0,
          bookmarks: 0,
        },
        captureStatus: 'full',
        notes: null,
        tags: [],
        imageUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    expect(m.imageUrl).toBeNull();
  });

  it('includes the image for a tweet WITH captured media', () => {
    const m = detailModel(
      {
        id: 't2',
        url: 'https://x.com/a/status/2',
        title: 'tweet2',
        description: null,
        siteName: null,
        sourceKind: 'twitter',
        sourceData: {
          kind: 'twitter',
          text: 'pic',
          authorHandle: 'a',
          authorName: 'A',
          likes: 0,
          reposts: 0,
          replies: 0,
          quotes: 0,
          bookmarks: 0,
        },
        captureStatus: 'full',
        notes: null,
        tags: [],
        imageUrl: 'https://pbs.twimg.com/x.jpg',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    // still the PROXY url, keyed by id — never the raw twimg host
    expect(m.imageUrl).toBe('http://localhost:8787/api/preview-image?linkId=t2');
  });

  it('omits the image for a plain link with no imageUrl', () => {
    const m = detailModel(
      {
        id: 'l1',
        url: 'https://x.dev',
        title: 'X',
        description: null,
        siteName: null,
        sourceKind: 'link',
        sourceData: { kind: 'link' },
        captureStatus: 'full',
        notes: null,
        tags: [],
        imageUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink & { imageUrl: null },
      base,
    );
    expect(m.imageUrl).toBeNull();
  });

  it('omits the image for a plain link even WITH a captured imageUrl (og:image) — plain links never image', () => {
    const m = detailModel(
      {
        id: 'l3',
        url: 'https://open.spotify.com/track/abc',
        title: 'Some Song',
        description: null,
        siteName: null,
        sourceKind: 'link',
        sourceData: { kind: 'link' },
        captureStatus: 'full',
        notes: null,
        tags: [],
        imageUrl: 'https://cdn.example/og.jpg',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    expect(m.imageUrl).toBeNull();
  });

  it('includes github stats', () => {
    const m = detailModel(
      {
        id: 'g1',
        url: 'https://github.com/x/y',
        title: 'y',
        description: null,
        siteName: null,
        sourceKind: 'link',
        sourceData: {
          kind: 'github',
          stars: 10,
          forks: 2,
          issues: 1,
          language: 'TypeScript',
        },
        captureStatus: 'full',
        notes: null,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    expect(m.stats.find((s) => s.label === 'Stars')?.value).toBe('10');
    expect(m.imageUrl).toBeNull();
  });

  it('omits the image for a github link even WITH a captured imageUrl (GitHub never images)', () => {
    const m = detailModel(
      {
        id: 'g2',
        url: 'https://github.com/x/z',
        title: 'z',
        description: null,
        siteName: null,
        sourceKind: 'link',
        sourceData: {
          kind: 'github',
          stars: 5,
          forks: 1,
          issues: 0,
        },
        captureStatus: 'full',
        notes: null,
        tags: [],
        imageUrl: 'https://cdn.example/og.jpg',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    expect(m.imageUrl).toBeNull();
  });

  it('builds the favicon url from the proxy, never the source host', () => {
    const m = detailModel(
      {
        id: 'l2',
        url: 'https://example.com/a',
        title: 'A',
        description: null,
        siteName: null,
        sourceKind: 'link',
        sourceData: { kind: 'link' },
        captureStatus: 'full',
        notes: null,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as CapturedLink,
      base,
    );
    expect(m.faviconUrl).toBe('http://localhost:8787/api/favicon?domain=example.com');
  });
});
