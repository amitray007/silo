import { describe, expect, it } from 'vitest';
import { xPostTitle } from './index.js';
import { buildPrompt, instructions, promptVersion } from './prompt.js';

const base = {
  authorName: 'Interfere',
  authorHandle: 'interfere',
  language: 'en',
  text: 'We added a command menu.',
  thread: [],
};

describe('buildPrompt', () => {
  it('uses the spec layout', () => {
    expect(buildPrompt(base)).toBe(
      [
        'Author: Interfere (@interfere)',
        'Language: en',
        'Post:',
        '<post>',
        'We added a command menu.',
        '</post>',
        'Thread context (may be empty):',
        '<thread>',
        '',
        '</thread>',
      ].join('\n'),
    );
  });

  it('says unknown when the language is missing', () => {
    expect(buildPrompt({ ...base, language: undefined })).toContain('Language: unknown');
  });

  it('cuts the post at 2,000 characters', () => {
    const prompt = buildPrompt({ ...base, text: 'a'.repeat(2_500) });
    expect(prompt).toContain('a'.repeat(2_000));
    expect(prompt).not.toContain('a'.repeat(2_001));
  });

  it('does not split a surrogate pair at the cut', () => {
    const prompt = buildPrompt({ ...base, text: `${'a'.repeat(1_999)}😀tail` });
    expect(prompt).not.toMatch(/[\ud800-\udbff]<\/post>/);
  });

  it('keeps at most 2 later posts, 500 characters each', () => {
    const prompt = buildPrompt({
      ...base,
      thread: ['b'.repeat(900), 'second', 'third'],
    });
    expect(prompt).toContain('b'.repeat(500));
    expect(prompt).not.toContain('b'.repeat(501));
    expect(prompt).toContain('second');
    expect(prompt).not.toContain('third');
  });
});

describe('x-post-title definition', () => {
  it('is wired to the feature id, version and budget', () => {
    expect(xPostTitle.id).toBe('x-post-title');
    expect(xPostTitle.promptVersion).toBe(promptVersion);
    expect(promptVersion).toBe(1);
    expect(xPostTitle.instructions).toBe(instructions);
    expect(xPostTitle.timeoutMs).toBe(15_000);
  });

  it('accepts a title object and rejects other shapes', () => {
    expect(xPostTitle.schema.safeParse({ title: 'A title' }).success).toBe(true);
    expect(xPostTitle.schema.safeParse({ name: 'A title' }).success).toBe(false);
    expect(xPostTitle.schema.safeParse('A title').success).toBe(false);
  });

  it('turns a rejected title into undefined so the runner falls back', () => {
    expect(xPostTitle.postProcess({ title: 'Sorry, no' })).toBeUndefined();
    expect(xPostTitle.postProcess({ title: '"Interfere adds a menu."' })).toBe(
      'Interfere adds a menu',
    );
  });
});
