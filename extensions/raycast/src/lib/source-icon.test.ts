import { describe, expect, it } from 'vitest';
import { domainOf, sourceIcon } from './source-icon.js';
import type { CapturedLink } from './types.js';

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
  it('picks a distinct icon per source kind', () => {
    const link1 = sourceIcon(link({ sourceKind: 'twitter' }));
    const link2 = sourceIcon(link({ sourceKind: 'hacker_news' }));
    const link3 = sourceIcon(
      link({ sourceData: { kind: 'github', stars: 1, forks: 0, issues: 0 } }),
    );
    const link4 = sourceIcon(
      link({ sourceData: { kind: 'youtube', channel: 'x', thumbnailUrl: 'y' } }),
    );
    const link5 = sourceIcon(link());

    const icons = [link1, link2, link3, link4, link5];
    expect(new Set(icons).size).toBeGreaterThan(1);
  });
});
