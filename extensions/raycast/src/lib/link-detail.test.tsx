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
