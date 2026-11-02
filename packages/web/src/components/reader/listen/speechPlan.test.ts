import { describe, expect, it } from 'vitest';
import { buildUnits, splitLong } from './speechPlan';

const block = (name: string) => ({ name }) as unknown as Element;
const A = block('a');
const B = block('b');
const text = (value: string, parent = A, kind: 'text' | 'heading' = 'text') => ({
  text: value,
  block: parent,
  kind,
});

describe('buildUnits', () => {
  it.each([
    ['short', [200, 450, 600]],
    ['relaxed', [360, 610, 760]],
    ['natural', [0, 150, 250]],
  ] as const)('plans sentence, paragraph and heading pauses for %s', (mode, pauses) => {
    const long = 'A sentence long enough to stay separate from the following sentence. ';
    const units = buildUnits([text(long), text(long), text('Title', B, 'heading')], 0, mode);
    expect(units.map((unit) => unit.pause)).toEqual(pauses);
  });

  it('defaults to relaxed pauses after paragraphs and headings', () => {
    const units = buildUnits(
      [
        text('A heading.', A, 'heading'),
        text('First body sentence is long enough to stand alone here.', B),
      ],
      0,
    );
    expect(units.map((unit) => unit.pause)).toEqual([760, 610]);
  });

  it('merges adjacent short sentences of one paragraph up to 200 characters', () => {
    const units = buildUnits([text('Short one.'), text('Short two.'), text('Short three.')], 0);
    expect(units).toHaveLength(1);
    expect(units[0]?.text).toBe('Short one. Short two. Short three.');
    expect(units[0]?.parts.map((part) => part.seg)).toEqual([0, 1, 2]);
    expect(units[0]?.pause).toBe(610);
  });

  it('does not merge two long sentences, or sentences of different blocks', () => {
    const long = 'x'.repeat(80);
    const units = buildUnits([text(`${long}.`), text(`${long}!`)], 0);
    expect(units.map((unit) => unit.pause)).toEqual([360, 610]);
    expect(buildUnits([text('Hi.', A), text('Yo.', B)], 0)).toHaveLength(2);
  });

  it('never merges a heading with the text around it', () => {
    const units = buildUnits([text('Intro.'), text('Title.', A, 'heading'), text('After.')], 0);
    expect(units).toHaveLength(3);
  });

  it('stops merging when the unit would pass 200 characters', () => {
    const units = buildUnits([text('a'.repeat(150)), text('b'.repeat(55)), text('Tiny.')], 0);
    expect(units.map((unit) => unit.parts.length)).toEqual([1, 2]);
  });

  it('plans from a sentence onward', () => {
    const units = buildUnits([text('Zero is first.', A), text('One is next.', B)], 1);
    expect(units).toHaveLength(1);
    expect(units[0]?.parts[0]?.seg).toBe(1);
  });

  it('splits a sentence over 300 characters at clause boundaries, and pauses only at its end', () => {
    const clause = 'this clause runs on for a good while, ';
    const long = `${clause.repeat(12)}and then it stops.`;
    const units = buildUnits([text(long)], 0);
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((unit) => unit.text.length <= 300)).toBe(true);
    expect(units.at(-1)?.pause).toBe(610);
    expect(units.slice(0, -1).every((unit) => unit.pause === 0)).toBe(true);
    expect(units.every((unit) => unit.parts[0]?.seg === 0)).toBe(true);
  });
});

describe('splitLong', () => {
  it('cuts a clause with no punctuation at a space', () => {
    const pieces = splitLong('word '.repeat(120).trim());
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((piece) => piece.length <= 300)).toBe(true);
    expect(pieces.join(' ')).toBe('word '.repeat(120).trim());
  });
});
