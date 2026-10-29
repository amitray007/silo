import { describe, expect, it } from 'vitest';
import fixtures from './fixtures.json' with { type: 'json' };
import { buildPrompt } from './prompt.js';

describe('fixtures', () => {
  it('covers the languages and kinds the spec lists', () => {
    const languages = new Set(fixtures.map((f) => f.language));
    for (const language of ['en', 'es', 'ja', 'hi']) expect(languages.has(language)).toBe(true);
    const kinds = fixtures.map((f) => f.kind).join(' | ');
    for (const kind of [
      'launch',
      'opinion',
      'joke',
      'reply fragment',
      'link',
      'image only',
      'long thread',
      'prompt injection',
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  it('marks synthetic posts and gives every fixture a note', () => {
    for (const fixture of fixtures) {
      expect(['real', 'synthetic']).toContain(fixture.source);
      expect(fixture.note.length).toBeGreaterThan(10);
      expect(fixture.threadAfter.length).toBeLessThanOrEqual(2);
    }
    expect(fixtures.filter((f) => f.source === 'synthetic').map((f) => f.id)).toEqual([
      'synthetic-interfere',
      'synthetic-injection',
    ]);
  });

  it('builds a prompt for every fixture', () => {
    for (const fixture of fixtures) {
      const prompt = buildPrompt({
        authorName: fixture.authorName,
        authorHandle: fixture.authorHandle,
        language: fixture.language ?? undefined,
        text: fixture.text,
        thread: fixture.threadAfter,
      });
      expect(prompt).toContain(`@${fixture.authorHandle}`);
    }
  });
});
