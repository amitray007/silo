import { describe, expect, it } from 'vitest';
import { EdgeTrimmer } from './trim';

const RATE = 24000;
const samples = (ms: number, value = 0) =>
  new Float32Array(Math.round((RATE * ms) / 1000)).fill(value);
function join(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
function trim(chunks: Float32Array[]): Float32Array {
  const trimmer = new EdgeTrimmer(RATE);
  return join([...chunks.flatMap((chunk) => trimmer.push(chunk)), ...trimmer.finish()]);
}

describe('EdgeTrimmer', () => {
  it('trims lead and tail silence while keeping 30 ms before and 60 ms after speech', () => {
    const out = trim([join([samples(150), samples(200, 0.5), samples(600)])]);
    expect(out.length).toBe(6960);
    expect(out.subarray(0, RATE * 0.03).every((v) => v === 0)).toBe(true);
    expect(out[RATE * 0.03]).toBe(0.5);
    expect(out.subarray(RATE * 0.23).every((v) => v === 0)).toBe(true);
  });

  it('gives identical samples across awkward chunk boundaries, including a partial final window', () => {
    const input = join([
      samples(153),
      samples(217, 0.5),
      samples(333),
      samples(157, 0.25),
      samples(613),
    ]);
    const chunks: Float32Array[] = [];
    for (let i = 0; i < input.length; i += 137) chunks.push(input.subarray(i, i + 137));
    expect(trim(chunks)).toEqual(trim([input]));
  });

  it('holds an internal pause until speech resumes and then releases every sample', () => {
    const trimmer = new EdgeTrimmer(RATE);
    const first = trimmer.push(join([samples(100), samples(200, 0.5)]));
    expect(first.reduce((n, c) => n + c.length, 0)).toBeGreaterThan(0);
    const keptTail = trimmer.push(samples(400));
    expect(keptTail.reduce((n, c) => n + c.length, 0)).toBe(RATE * 0.06);
    expect(trimmer.push(samples(100))).toEqual([]);
    const rest = trimmer.push(join([samples(200, 0.25), samples(500)]));
    const out = join([...first, ...keptTail, ...rest, ...trimmer.finish()]);
    expect(out.length).toBe(RATE * 0.99);
    expect(out.subarray(RATE * 0.23, RATE * 0.73)).toEqual(samples(500));
    expect(out[RATE * 0.73]).toBe(0.25);
  });

  it('returns 50 ms of silence for an all-silent or empty unit', () => {
    for (const chunks of [[], [samples(700)], [samples(2, 0.001)]]) {
      const out = trim(chunks);
      expect(out).toEqual(samples(50));
    }
  });

  it('fades the cuts linearly to zero without mutating input or adding a step', () => {
    const input = samples(200, 0.5);
    const out = trim([input]);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(0);
    const fade = RATE * 0.005;
    expect(out[fade - 1]).toBe(0.5);
    expect(out[out.length - fade]).toBe(0.5);
    for (let i = 1; i < fade; i += 1) {
      expect((out[i] ?? 0) - (out[i - 1] ?? 0)).toBeCloseTo(0.5 / (fade - 1), 6);
      expect((out[out.length - i - 1] ?? 0) - (out[out.length - i] ?? 0)).toBeCloseTo(
        0.5 / (fade - 1),
        6,
      );
    }
    expect(input.every((v) => v === 0.5)).toBe(true);
    const chunks: Float32Array[] = [];
    for (let i = 0; i < input.length; i += 37) chunks.push(input.subarray(i, i + 37));
    expect(trim(chunks)).toEqual(out);
  });

  it('keeps a soft -45 dBFS ending', () => {
    const soft = 10 ** (-45 / 20);
    const out = trim([join([samples(100), samples(200, 0.5), samples(150, soft), samples(700)])]);
    expect(out.length).toBe(RATE * 0.44);
    expect(out.subarray(RATE * 0.23, RATE * 0.38)).toEqual(samples(150, soft));
  });

  it('processes a partial last window and keeps speech in a very short unit', () => {
    expect(trim([samples(3, 0.5)]).length).toBe(RATE * 0.003);
  });
});
