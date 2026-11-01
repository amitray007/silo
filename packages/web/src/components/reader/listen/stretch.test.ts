import { describe, expect, it } from 'vitest';
import { stretch } from './stretch';

const RATE = 24000;
function sine(hz: number, seconds: number): Float32Array {
  return Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / RATE),
  );
}

/** Rising zero crossings per second: a stand-in for pitch. */
function crossingsPerSecond(samples: Float32Array): number {
  let count = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] ?? 0) < 0 && (samples[i] ?? 0) >= 0) count += 1;
  }
  return count / (samples.length / RATE);
}

describe('stretch', () => {
  it('returns the input at 1x', () => {
    const input = sine(200, 0.2);
    expect(stretch(input, 1)).toBe(input);
  });

  it('shortens the audio by the rate', () => {
    const input = sine(200, 2);
    for (const rate of [1.25, 1.5, 2, 3]) {
      expect(stretch(input, rate).length).toBe(Math.floor(input.length / rate));
    }
  });

  it('lengthens the audio below 1x', () => {
    const input = sine(200, 2);
    expect(stretch(input, 0.75).length).toBe(Math.floor(input.length / 0.75));
  });

  it('keeps the pitch while changing the speed', () => {
    const input = sine(200, 2);
    for (const rate of [0.75, 1.5, 2]) {
      const out = stretch(input, rate);
      expect(crossingsPerSecond(out)).toBeGreaterThan(190);
      expect(crossingsPerSecond(out)).toBeLessThan(210);
    }
  });

  it('keeps the level steady and finite', () => {
    const out = stretch(sine(150, 1.5), 1.75);
    const peak = out.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThan(1.2);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it('copes with input shorter than one window', () => {
    expect(stretch(new Float32Array(300), 2).length).toBe(150);
  });

  it('produces exactly the target length at every speed', () => {
    for (const length of [24000, 24001, 47999, 100003]) {
      const input = sine(180, length / RATE);
      for (const rate of [0.75, 1.25, 1.5, 2, 3]) {
        expect(stretch(input, rate).length).toBe(Math.floor(input.length / rate));
      }
    }
  });

  it('keeps the audio to the very end: no trailing silence, no hard cut', () => {
    const rms = (samples: Float32Array) =>
      Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    const tail = RATE / 50; // the last 20 ms
    const input = sine(150, 1.7);
    const reference = rms(input.subarray(input.length - tail));
    for (const rate of [0.75, 1.5, 3]) {
      const out = stretch(input, rate);
      const end = rms(out.subarray(out.length - tail));
      expect(end).toBeGreaterThan(reference * 0.7);
      expect(end).toBeLessThan(reference * 1.3);
      // The last 2 ms must not have faded to nothing either.
      expect(rms(out.subarray(out.length - 48))).toBeGreaterThan(reference * 0.3);
    }
  });
});
