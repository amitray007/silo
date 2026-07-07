import { describe, expect, it } from 'vitest';
import { buildDetailMarkdown, statusLabel } from './detail-markdown.js';
import type { CapturedLink } from './types.js';

function link(overrides: Partial<CapturedLink> = {}): CapturedLink {
  return {
    id: '1',
    url: 'https://github.com/kodless/leek',
    title: 'kodless/leek',
    description: 'Celery Tasks Monitoring Tool',
    siteName: 'GitHub',
    sourceKind: 'link',
    sourceData: { kind: 'link' },
    captureStatus: 'full',
    notes: null,
    tags: [],
    createdAt: '2026-07-07T09:00:00Z',
    updatedAt: '2026-07-07T09:00:00Z',
    ...overrides,
  };
}

describe('buildDetailMarkdown', () => {
  it('includes the title and description', () => {
    const md = buildDetailMarkdown(link());
    expect(md).toContain('kodless/leek');
    expect(md).toContain('Celery Tasks Monitoring Tool');
  });

  it('includes a GitHub stat row with stars/forks/issues', () => {
    const md = buildDetailMarkdown(
      link({
        sourceData: { kind: 'github', stars: 204, forks: 20, issues: 14, language: 'Python' },
      }),
    );
    expect(md).toContain('204');
    expect(md).toContain('20');
    expect(md).toContain('14');
    expect(md).toContain('Python');
  });

  it('includes a Hacker News stat row with points/comments', () => {
    const md = buildDetailMarkdown(
      link({
        sourceKind: 'hacker_news',
        sourceData: { kind: 'hacker_news', points: 150, comments: 42, author: 'pg' },
      }),
    );
    expect(md).toContain('150');
    expect(md).toContain('42');
    expect(md).toContain('pg');
  });

  it('falls back to the domain when title is missing', () => {
    const md = buildDetailMarkdown(link({ title: null, url: 'https://example.com/page' }));
    expect(md).toContain('example.com');
  });

  it('escapes markdown special characters in the title/description', () => {
    const md = buildDetailMarkdown(
      link({ title: '[hack] *the* planet', description: undefined as unknown as string | null }),
    );
    expect(md).toContain('\\[hack\\] \\*the\\* planet');
  });
});

describe('statusLabel', () => {
  it('labels every capture status', () => {
    expect(statusLabel('enriching')).toContain('Enriching');
    expect(statusLabel('full')).toBe('Full');
    expect(statusLabel('partial')).toBe('Partial');
    expect(statusLabel('bare')).toBe('Bare');
  });
});
