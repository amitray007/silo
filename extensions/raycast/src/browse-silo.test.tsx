import { describe, expect, it } from 'vitest';
import { daysUntilPurge, scopeLabel } from './browse-silo.js';

describe('daysUntilPurge', () => {
  it('computes days left until purge', () => {
    const deleted = new Date('2026-07-01T00:00:00Z').toISOString();
    const now = new Date('2026-07-08T00:00:00Z');
    expect(daysUntilPurge(deleted, 30, now)).toBe(23);
  });

  it('never returns negative — a link overdue for purge shows 0', () => {
    const deleted = new Date('2026-01-01T00:00:00Z').toISOString();
    const now = new Date('2026-07-08T00:00:00Z');
    expect(daysUntilPurge(deleted, 30, now)).toBe(0);
  });
});

describe('scopeLabel', () => {
  it('labels the built-in scopes', () => {
    expect(scopeLabel('library')).toBe('Library');
    expect(scopeLabel('trash')).toBe('Trash');
  });

  it('labels a tag scope by its name', () => {
    expect(scopeLabel('tag:design')).toBe('design');
  });
});
