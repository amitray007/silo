// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import type { Segment } from './useReadAloud';

/** A synthesis unit: one or more sentences merged, or a clause-split piece of a long sentence. */
export type Unit = {
  text: string;
  /** The sentences this unit covers, with their share of the text, for highlight timing. */
  parts: { seg: number; chars: number }[];
  /** Silence scheduled after the unit, in ms. */
  pause: number;
};

const SHORT = 60;
const MERGE_MAX = 200;
const LONG = 300;
const PIECE = 220;

function splitLong(text: string): string[] {
  const clauses = text.split(/(?<=[,;:—–])\s+/);
  const pieces: string[] = [];
  let current = '';
  for (const clause of clauses) {
    if (current && current.length + clause.length + 1 > PIECE) {
      pieces.push(current);
      current = clause;
    } else current = current ? `${current} ${clause}` : clause;
  }
  if (current) pieces.push(current);
  // A single clause that is still too long is cut at a space.
  return pieces.flatMap((piece) => {
    if (piece.length <= LONG) return [piece];
    const cut: string[] = [];
    let rest = piece;
    while (rest.length > LONG) {
      const at = rest.lastIndexOf(' ', PIECE);
      cut.push(rest.slice(0, at > 0 ? at : PIECE));
      rest = rest.slice(at > 0 ? at + 1 : PIECE);
    }
    if (rest) cut.push(rest);
    return cut;
  });
}

/** Plan synthesis from a sentence onward. Headings never merge. */
export function buildUnits(segments: Segment[], from: number): Unit[] {
  const units: Unit[] = [];
  for (let i = from; i < segments.length; i += 1) {
    const segment = segments[i] as Segment;
    const next = segments[i + 1];
    const endsBlock = !next || next.block !== segment.block;
    const pause = segment.kind === 'heading' ? 250 : endsBlock ? 150 : 0;
    if (segment.text.length > LONG) {
      const pieces = splitLong(segment.text);
      pieces.forEach((piece, k) => {
        units.push({
          text: piece,
          parts: [{ seg: i, chars: piece.length }],
          pause: k === pieces.length - 1 ? pause : 0,
        });
      });
      continue;
    }
    const unit: Unit = {
      text: segment.text,
      parts: [{ seg: i, chars: segment.text.length }],
      pause,
    };
    let last = segment;
    while (i + 1 < segments.length) {
      const candidate = segments[i + 1] as Segment;
      const merge =
        candidate.block === last.block &&
        last.kind !== 'heading' &&
        candidate.kind !== 'heading' &&
        (unit.text.length < SHORT || candidate.text.length < SHORT) &&
        unit.text.length + 1 + candidate.text.length <= MERGE_MAX;
      if (!merge) break;
      unit.text = `${unit.text} ${candidate.text}`;
      unit.parts.push({ seg: i + 1, chars: candidate.text.length });
      i += 1;
      last = candidate;
      const after = segments[i + 1];
      unit.pause = last.kind === 'heading' ? 250 : !after || after.block !== last.block ? 150 : 0;
    }
    units.push(unit);
  }
  return units;
}

/**
 * Pitch-preserving time stretch (WSOLA). `rate` above 1 plays faster. Used for engines with no
 * native speed option, so a faster voice does not turn into a chipmunk.
 */
export function stretch(input: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 0.01) return input;
  const N = 1024;
  const hop = N / 2;
  const tolerance = 256;
  const target = Math.floor(input.length / rate);
  const out = new Float32Array(target + N);
  const weight = new Float32Array(target + N);
  const window = new Float32Array(N);
  for (let j = 0; j < N; j += 1) window[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (N - 1));
  let previous = 0;
  for (let frame = 0, at = 0; at + N <= target + N; frame += 1, at += hop) {
    const ideal = Math.round(frame * hop * rate);
    if (ideal + N + tolerance >= input.length) break;
    let best = ideal;
    if (frame > 0) {
      const reference = previous + hop;
      let score = Number.NEGATIVE_INFINITY;
      for (let d = -tolerance; d <= tolerance; d += 2) {
        const position = ideal + d;
        if (position < 0 || position + N > input.length) continue;
        let sum = 0;
        for (let j = 0; j < N; j += 8)
          sum += (input[position + j] ?? 0) * (input[reference + j] ?? 0);
        if (sum > score) {
          score = sum;
          best = position;
        }
      }
    }
    for (let j = 0; j < N; j += 1) {
      out[at + j] = (out[at + j] ?? 0) + (input[best + j] ?? 0) * (window[j] ?? 0);
      weight[at + j] = (weight[at + j] ?? 0) + (window[j] ?? 0);
    }
    previous = best;
  }
  for (let j = 0; j < out.length; j += 1)
    if ((weight[j] ?? 0) > 1e-3) out[j] = (out[j] ?? 0) / (weight[j] ?? 1);
  return out.subarray(0, target);
}
