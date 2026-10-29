import { describe, expect, it } from 'vitest';
import { isDarkOnTransparent } from './faviconTone';

/** 4x4 RGBA buffer: each cell is [r, g, b, a]. */
function icon(cells: Array<[number, number, number, number]>): Uint8ClampedArray {
  return Uint8ClampedArray.from(cells.flat());
}
const fill = (n: number, px: [number, number, number, number]) => Array(n).fill(px);
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];

const RED: [number, number, number, number] = [255, 0, 0, 255];
const GRAY: [number, number, number, number] = [87, 87, 87, 255]; // relative luminance ~0.095

describe('isDarkOnTransparent', () => {
  it('flags thin black strokes at low coverage', () => {
    expect(isDarkOnTransparent(icon([...fill(13, CLEAR), ...fill(3, [0, 0, 0, 255])]))).toBe(true);
  });

  it('flags semi-transparent black strokes that downsampling softened', () => {
    expect(isDarkOnTransparent(icon([...fill(8, CLEAR), ...fill(8, [0, 0, 0, 90])]))).toBe(true);
  });

  it('leaves red and white art on partial cover alone', () => {
    expect(isDarkOnTransparent(icon([...fill(6, CLEAR), ...fill(6, RED), ...fill(4, WHITE)]))).toBe(
      false,
    );
  });

  it('leaves mid-gray art on transparent alone', () => {
    expect(isDarkOnTransparent(icon([...fill(8, CLEAR), ...fill(8, GRAY)]))).toBe(false);
  });

  it('leaves white art on a transparent background alone', () => {
    expect(isDarkOnTransparent(icon([...fill(8, CLEAR), ...fill(8, WHITE)]))).toBe(false);
  });

  it('leaves an opaque black tile alone', () => {
    expect(isDarkOnTransparent(icon(fill(16, BLACK)))).toBe(false);
  });

  it('leaves a fully transparent icon alone', () => {
    expect(isDarkOnTransparent(icon(fill(16, CLEAR)))).toBe(false);
  });

  it('treats an empty buffer as not dark', () => {
    expect(isDarkOnTransparent(new Uint8ClampedArray(0))).toBe(false);
  });
});
