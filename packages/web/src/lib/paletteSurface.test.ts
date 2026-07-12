import { describe, expect, it } from 'vitest';
import { isPaletteSurfaceOn } from './paletteSurface';

describe('isPaletteSurfaceOn', () => {
  it('is on when both enabled and palette are true', () => {
    expect(isPaletteSurfaceOn({ enabled: true, palette: true })).toBe(true);
  });
  it('is off when the source is disabled', () => {
    expect(isPaletteSurfaceOn({ enabled: false, palette: true })).toBe(false);
  });
  it('is off when the palette flag is off', () => {
    expect(isPaletteSurfaceOn({ enabled: true, palette: false })).toBe(false);
  });
  it('defaults to ON while settings are still loading (undefined)', () => {
    expect(isPaletteSurfaceOn(undefined)).toBe(true);
  });
});
