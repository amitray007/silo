const WINDOW = 1024;
const HOP = WINDOW / 2;
/** How far a frame may slide to line up with the previous one, in samples. */
const TOLERANCE = 256;

const HANN = Float32Array.from(
  { length: WINDOW },
  (_, j) => 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (WINDOW - 1)),
);

/** The offset near `ideal` whose waveform best matches the tail of the previous frame. */
function bestOffset(input: Float32Array, ideal: number, reference: number): number {
  let best = ideal;
  let score = Number.NEGATIVE_INFINITY;
  for (let d = -TOLERANCE; d <= TOLERANCE; d += 2) {
    const position = ideal + d;
    if (position < 0 || position + WINDOW > input.length) continue;
    let sum = 0;
    for (let j = 0; j < WINDOW; j += 8)
      sum += (input[position + j] ?? 0) * (input[reference + j] ?? 0);
    if (sum > score) {
      score = sum;
      best = position;
    }
  }
  return best;
}

/** Add one windowed frame of the input into the output, keeping the weights for normalising. */
function addFrame(
  out: Float32Array,
  weight: Float32Array,
  input: Float32Array,
  from: number,
  at: number,
): void {
  for (let j = 0; j < WINDOW; j += 1) {
    const w = HANN[j] ?? 0;
    out[at + j] = (out[at + j] ?? 0) + (input[from + j] ?? 0) * w;
    weight[at + j] = (weight[at + j] ?? 0) + w;
  }
}

/**
 * Pitch-preserving time stretch (WSOLA). `rate` above 1 plays faster. It serves engines with no
 * native speed option, so a faster voice does not turn into a chipmunk.
 */
export function stretch(input: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 0.01) return input;
  const target = Math.floor(input.length / rate);
  const out = new Float32Array(target + WINDOW);
  const weight = new Float32Array(target + WINDOW);
  let previous = 0;
  for (let frame = 0, at = 0; at <= target; frame += 1, at += HOP) {
    const ideal = Math.round(frame * HOP * rate);
    if (ideal + WINDOW + TOLERANCE >= input.length) break;
    previous = frame > 0 ? bestOffset(input, ideal, previous + HOP) : ideal;
    addFrame(out, weight, input, previous, at);
  }
  for (let j = 0; j < out.length; j += 1) {
    const w = weight[j] ?? 0;
    if (w > 1e-3) out[j] = (out[j] ?? 0) / w;
  }
  return out.subarray(0, target);
}
