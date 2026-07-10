import { Icon } from '@raycast/api';
import { describe, expect, it } from 'vitest';
import { domainOf, sourceIcon } from './source-icon.js';
import type { CapturedLink } from './types.js';

const base = 'http://localhost:8787';

function link(overrides: Partial<CapturedLink> = {}): CapturedLink {
  return {
    id: '1',
    url: 'https://example.com/page',
    title: 'Example',
    description: null,
    siteName: null,
    sourceKind: 'link',
    sourceData: { kind: 'link' },
    captureStatus: 'full',
    notes: null,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('domainOf', () => {
  it('strips the protocol, path, and a leading www.', () => {
    expect(domainOf('https://www.example.com/some/path?x=1')).toBe('example.com');
    expect(domainOf('https://github.com/kodless/leek')).toBe('github.com');
  });

  it('falls back to the raw value on an unparseable URL', () => {
    expect(domainOf('not-a-url')).toBe('not-a-url');
  });
});

describe('sourceIcon', () => {
  it('picks a distinct icon per known source kind', () => {
    const link1 = sourceIcon(link({ sourceKind: 'twitter' }), base);
    const link2 = sourceIcon(link({ sourceKind: 'hacker_news' }), base);
    const link3 = sourceIcon(
      link({ sourceData: { kind: 'github', stars: 1, forks: 0, issues: 0 } }),
      base,
    );
    const link4 = sourceIcon(
      link({ sourceData: { kind: 'youtube', channel: 'x', thumbnailUrl: 'y' } }),
      base,
    );

    const icons = [link1, link2, link3, link4];
    expect(new Set(icons).size).toBeGreaterThan(1);
  });

  it('youtube link returns the Play icon (enum, unchanged)', () => {
    const icon = sourceIcon(
      link({ sourceData: { kind: 'youtube', channel: 'x', thumbnailUrl: 'y' } }),
      base,
    );
    expect(icon).toBe(Icon.Play);
  });

  it('github link returns the Code icon (enum, unchanged)', () => {
    const icon = sourceIcon(
      link({ sourceData: { kind: 'github', stars: 1, forks: 0, issues: 0 } }),
      base,
    );
    expect(icon).toBe(Icon.Code);
  });

  it('plain link returns the site favicon via the proxy, with the link glyph as fallback', () => {
    const icon = sourceIcon(link({ url: 'https://www.example.com/page' }), base);
    expect(icon).toEqual({
      source: 'http://localhost:8787/api/favicon?domain=example.com',
      fallback: Icon.Link,
    });
  });
});
