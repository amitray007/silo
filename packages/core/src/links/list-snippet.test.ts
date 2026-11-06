import { describe, expect, it } from 'vitest';
import { LIST_SNIPPET_MAX_CHARS, NEEDS_FULL_TEXT, snippetFromText } from './list-snippet.js';

/** The original, unbounded implementation: collapse the whole text, then cut. */
function referenceSnippet(text: string | null | undefined): string | null {
  const collapsed = text?.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= LIST_SNIPPET_MAX_CHARS) return collapsed;
  const hardCut = collapsed.slice(0, LIST_SNIPPET_MAX_CHARS);
  const lastSpace = hardCut.lastIndexOf(' ');
  const cut = lastSpace > LIST_SNIPPET_MAX_CHARS * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut}…`;
}

/** Deterministic pseudo-random generator so a failure is reproducible. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

const PIECES = ['word', 'a', 'longerword', ' ', '  ', '\n', '\n\n', '\t', ' ', '﻿', '😀', '日本語'];

function randomText(next: () => number, length: number): string {
  let out = '';
  while (out.length < length) out += PIECES[Math.floor(next() * PIECES.length)] ?? '';
  return out;
}

/** What `list()` does with a stored value: read a prefix, retry with the whole value when it cannot settle. */
function viaPrefix(full: string, prefixChars: number): string | null {
  const prefix = [...full].slice(0, prefixChars).join('');
  const first = snippetFromText(prefix, prefix.length < prefixChars);
  return first === NEEDS_FULL_TEXT ? snippetFromText(full, true) : first;
}

describe('snippetFromText', () => {
  it('matches the unbounded implementation on whitespace-heavy hand-written cases', () => {
    const cases: Array<string | null | undefined> = [
      null,
      undefined,
      '',
      '   \n\t  ',
      'short text',
      `${'x'.repeat(200)}`,
      `${'x'.repeat(201)}`,
      `${'x'.repeat(200)}${' '.repeat(5000)}`, // exactly 200 visible chars, trailing padding only
      `${'x'.repeat(200)}${' '.repeat(5000)}y`, // a 201st char far past the slice
      `${' '.repeat(5000)}${'word '.repeat(100)}`, // leading padding larger than the slice
      `${'word\n\n\n'.repeat(900)}`, // every word separated by a long run
      `${'a b '.repeat(40)}${'\n'.repeat(3000)}tail`,
      `${' '.repeat(2000)}text${' '.repeat(2000)}`,
      '😀'.repeat(1500),
      `${'word '.repeat(30)}${'😀 '.repeat(800)}`,
    ];
    for (const text of cases) {
      expect(snippetFromText(text, true)).toBe(referenceSnippet(text));
      if (text) expect(viaPrefix(text, 1024)).toBe(referenceSnippet(text));
    }
  });

  it('matches the unbounded implementation on random whitespace-dense text, complete or via a prefix', () => {
    const next = rng(42);
    for (let i = 0; i < 400; i++) {
      const text = randomText(next, 50 + Math.floor(next() * 6000));
      const expected = referenceSnippet(text);
      expect(snippetFromText(text, true)).toBe(expected);
      expect(viaPrefix(text, 1024)).toBe(expected);
      expect(viaPrefix(text, 64)).toBe(expected);
    }
  });

  it('asks for the whole value when a prefix is too short to settle the snippet', () => {
    expect(snippetFromText(`word${' '.repeat(1100)}`, false)).toBe(NEEDS_FULL_TEXT);
    expect(snippetFromText('x'.repeat(300), false)).toBe(`${'x'.repeat(200)}…`);
  });

  it('settles a prefix without the full text once a non-space character sits past the budget', () => {
    expect(snippetFromText(`${'ab '.repeat(120)}`, false)).not.toBe(NEEDS_FULL_TEXT);
  });
});
