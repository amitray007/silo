import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { domainOf, formatLinkLine, richHint, shortId, statusBadge, truncate } from './format.js';
import type { LinkJson } from './types.js';

function baseLink(overrides: Partial<LinkJson> = {}): LinkJson {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    url: 'https://example.com/post',
    title: 'A post',
    description: null,
    imageUrl: null,
    siteName: null,
    extractedText: null,
    sourceKind: 'link',
    sourceData: { kind: 'link' },
    captureStatus: 'full',
    addedBy: 'user',
    source: 'unknown',
    notes: null,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('shortId', () => {
  it('truncates to 8 chars', () => {
    expect(shortId('11111111-1111-1111-1111-111111111111')).toBe('11111111');
  });
});

describe('domainOf', () => {
  it('extracts the hostname, stripping www.', () => {
    expect(domainOf('https://www.example.com/a/b')).toBe('example.com');
  });

  it('returns the raw string for an unparseable url rather than throwing', () => {
    expect(domainOf('not a url')).toBe('not a url');
  });
});

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('cuts long text with an ellipsis', () => {
    expect(truncate('a very long piece of text', 10)).toBe('a very lo…');
    expect(truncate('a very long piece of text', 10).length).toBe(10);
  });
});

describe('richHint', () => {
  it('formats github stars', () => {
    const link = baseLink({
      sourceData: { kind: 'github', stars: 204, forks: 1, issues: 0 },
    });
    expect(richHint(link)).toBe('★204');
  });

  it('formats hacker_news points', () => {
    const link = baseLink({
      sourceData: { kind: 'hacker_news', points: 104, comments: 5, author: 'a' },
    });
    expect(richHint(link)).toBe('▲104');
  });

  it('formats twitter likes', () => {
    const link = baseLink({
      sourceData: {
        kind: 'twitter',
        text: 'hi',
        authorHandle: 'a',
        authorName: 'A',
        likes: 45,
        reposts: 0,
        replies: 0,
        quotes: 0,
        bookmarks: 0,
      },
    });
    expect(richHint(link)).toBe('♥45');
  });

  it('returns empty string for a plain link', () => {
    expect(richHint(baseLink())).toBe('');
  });
});

describe('statusBadge / formatLinkLine (no-TTY)', () => {
  const originalIsTty = process.stdout.isTTY;

  beforeEach(() => {
    // Force non-TTY so no ANSI escape codes appear in assertions — mirrors
    // how these run under `vitest run` (piped output) already, but made
    // explicit so this test doesn't silently depend on the runner's stdout.
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTty, configurable: true });
  });

  it('prints a plain status word with no ANSI codes when not a TTY', () => {
    expect(statusBadge('enriching')).toBe('enriching');
    expect(statusBadge('full')).toBe('full');
  });

  it('formats a link line with id, title, domain, status', () => {
    const line = formatLinkLine(baseLink());
    expect(line).toContain('11111111');
    expect(line).toContain('A post');
    expect(line).toContain('example.com');
    expect(line).toContain('full');
  });

  it('includes a truncated note marker when notes are present', () => {
    const line = formatLinkLine(baseLink({ notes: 'a short note' }));
    expect(line).toContain('¶ a short note');
  });
});
