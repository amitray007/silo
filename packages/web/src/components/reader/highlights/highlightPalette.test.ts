import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_COLORS } from '../../../lib/highlights';

/** Reads the shipped stylesheet and checks the numbers the design promises. */
const css = readFileSync(resolve(process.cwd(), 'src/styles/highlight-palette.css'), 'utf8');

type Lab = [number, number, number];
type Theme = { text: Lab; tint: Record<string, Lab>; overlap: Record<string, Lab> };

const THEMES = {
  light: ':root {',
  dark: ':root[data-theme="dark"] {',
  sepia: '.silo-readerpane[data-reader-theme="sepia"] {',
  sepiaDark: ':root[data-theme="dark"] .silo-readerpane[data-reader-theme="sepia"] {',
};

function toLab(L: number, C: number, hue: number): Lab {
  const h = (hue * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

function parseOklch(value: string): Lab {
  const match = /oklch\(([\d.]+)% ([\d.]+) ?([\d.]*)\)/.exec(value);
  if (!match) throw new Error(`bad colour ${value}`);
  return toLab(Number(match[1]) / 100, Number(match[2]), Number(match[3] || 0));
}

function toLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminance(lab: Lab): number {
  const [r, g, b] = toLinear(lab).map((v) => Math.min(1, Math.max(0, v))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: Lab, b: Lab) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const distance = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

function block(opener: string): Record<string, string> {
  const start = css.indexOf(`\n${opener}`) + 1 || css.indexOf(opener);
  const end = css.indexOf('}', start);
  const body = css.slice(start + opener.length, end);
  return Object.fromEntries(
    [...body.matchAll(/--([a-z-]+): ([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

function theme(opener: string): Theme {
  const vars = block(opener);
  const tint: Record<string, Lab> = {};
  const overlap: Record<string, Lab> = {};
  for (const name of HIGHLIGHT_COLORS) {
    tint[name] = parseOklch(vars[`hl-${name}`] ?? '');
    overlap[name] = parseOklch(vars[`hl-${name}-ov`] ?? '');
  }
  return { text: parseOklch(vars['hl-text'] ?? ''), tint, overlap };
}

describe.each(Object.entries(THEMES))('highlight palette: %s', (_name, opener) => {
  const parsed = theme(opener);

  it('defines every colour, its overlap tint and its edge', () => {
    const vars = block(opener);
    for (const name of HIGHLIGHT_COLORS) {
      expect(vars[`hl-${name}`]).toBeDefined();
      expect(vars[`hl-${name}-ov`]).toBeDefined();
      expect(vars[`hl-${name}-edge`]).toBeDefined();
    }
  });

  it('keeps text on every tint, single and overlap, at 4.5:1 or better', () => {
    for (const name of HIGHLIGHT_COLORS) {
      expect(contrast(parsed.text, parsed.tint[name] as Lab)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parsed.text, parsed.overlap[name] as Lab)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps every pair of tints about 0.08 apart in OKLab', () => {
    for (const set of [parsed.tint, parsed.overlap]) {
      for (const a of HIGHLIGHT_COLORS)
        for (const b of HIGHLIGHT_COLORS)
          if (a < b) expect(distance(set[a] as Lab, set[b] as Lab)).toBeGreaterThanOrEqual(0.08);
    }
  });
});
