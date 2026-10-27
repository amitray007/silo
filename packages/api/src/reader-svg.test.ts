import { describe, expect, it } from 'vitest';
import { sizeReaderSvg } from './reader-svg.js';

const encode = (svg: string) => new TextEncoder().encode(svg);
const transform = (svg: string) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(sizeReaderSvg(encode(svg)));

describe('Reader SVG dimensions', () => {
  it.each([
    ['<svg viewBox="0 0 20 20"></svg>', 20, 20],
    ["<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1 -2 20 30'/>", 20, 30],
    ['<svg VIEWBOX="0,0,20,30" role="img"></svg>', 20, 30],
    ['<svg viewBox="0 0 999999 5000"></svg>', 4000, 20],
    ['<svg viewBox="0 0 .2 1.6"></svg>', 1, 2],
    ['<svg viewBox="0 0 2e1 3e1"></svg>', 20, 30],
    ['<?xml version="1.0"?><!-- <svg width="100"> --><svg viewBox="0 0 20 20"/>', 20, 20],
    ['<!DOCTYPE svg [<!ENTITY label "a>b">]><!-- note --><svg viewBox="0 0 20 20"/>', 20, 20],
  ])('sizes %s', (svg, width, height) => {
    const expected = svg.replace(
      /<svg(?=\s+viewBox|\s+xmlns|\s+VIEWBOX)/,
      `<svg width="${width}" height="${height}"`,
    );
    expect(transform(svg)).toBe(expected);
  });

  it.each([
    '<svg width="20" viewBox="0 0 20 20"/>',
    '<svg viewBox="0 0 20 20" height="20"/>',
    '<svg viewBox="0 0 20 20" WIDTH="20"/>',
    '<svg viewBox="0 0 0 10"/>',
    '<svg viewBox="a b c d"/>',
    '<svg/>',
    '<svg viewBox="0 0 -1 10"/>',
    '<svg viewBox="0 0 Infinity 10"/>',
    '<svg viewBox="0 0 1e999 10"/>',
    '<svg viewBox="0 0 20 20"><svg viewBox="0 0 10 10"/></svg>',
    '<g><svg viewBox="0 0 20 20"/></g>',
    '<svg viewBox="0 0 20 20" width=20/>',
    `<!--${'x'.repeat(4096)}--><svg viewBox="0 0 20 20"/>`,
  ])('preserves unchanged bytes for %s', (svg) => {
    // A dimensionless root with a nested SVG still changes only the root.
    if (svg.includes('<svg viewBox="0 0 10 10"')) {
      expect(transform(svg)).toBe(
        '<svg width="20" height="20" viewBox="0 0 20 20"><svg viewBox="0 0 10 10"/></svg>',
      );
      return;
    }
    const bytes = encode(svg);
    expect(sizeReaderSvg(bytes)).toBe(bytes);
  });

  it('preserves a UTF-8 BOM, non-ASCII prologue and large body byte for byte', () => {
    const svg = `\uFEFF<!-- café -->\n<svg viewBox="0 0 20 20"><text>${'字'.repeat(50000)}</text></svg>`;
    expect(transform(svg)).toBe(svg.replace('<svg ', '<svg width="20" height="20" '));
  });
});

it('preserves non-UTF-8 bytes before the root', () => {
  const bytes = new Uint8Array([
    ...encode('<!-- caf'),
    0xe9,
    ...encode(' --><svg viewBox="0 0 20 20"/>'),
  ]);
  expect(sizeReaderSvg(bytes)).toBe(bytes);
});

it.each([1, 2, 3])(
  'sizes a root before a character split %i bytes into the scan boundary',
  (split) => {
    const root = '<svg viewBox="0 0 20 30"><text>';
    const svg = `${root}${'x'.repeat(4096 - encode(root).length - split)}😀</text></svg>`;
    expect(transform(svg)).toBe(svg.replace('<svg ', '<svg width="20" height="30" '));
  },
);
