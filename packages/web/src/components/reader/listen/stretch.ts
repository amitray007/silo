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

/** Linear resampling: the fallback for audio too short to hold one frame (pitch moves, but it is a blip). */
function resample(input: Float32Array, target: number): Float32Array {
  const out = new Float32Array(target);
  const step = target > 1 ? (input.length - 1) / (target - 1) : 0;
  for (let i = 0; i < target; i += 1) {
    const at = i * step;
    const from = Math.floor(at);
    const next = Math.min(input.length - 1, from + 1);
    out[i] = (input[from] ?? 0) * (1 - (at - from)) + (input[next] ?? 0) * (at - from);
  }
  return out;
}

/**
 * Pitch-preserving time stretch (WSOLA). `rate` above 1 plays faster. It serves engines with no
 * native speed option, so a faster voice does not turn into a chipmunk. The result is exactly
 * `floor(length / rate)` samples: frames run until the target is covered, and the last ones sit
 * on the end of the input, so the audio neither ends in silence nor is cut.
 */
export function stretch(input: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 0.01) return input;
  const target = Math.floor(input.length / rate);
  if (target < 1 || input.length < WINDOW + TOLERANCE) return resample(input, target);
  const out = new Float32Array(target + WINDOW);
  const weight = new Float32Array(target + WINDOW);
  const lastFrame = input.length - WINDOW;
  let previous = 0;
  for (let frame = 0, at = 0; at < target; frame += 1, at += HOP) {
    const ideal = Math.min(lastFrame, Math.round(frame * HOP * rate));
    previous = frame > 0 ? bestOffset(input, ideal, previous + HOP) : ideal;
    addFrame(out, weight, input, previous, at);
  }
  for (let j = 0; j < target; j += 1) {
    const w = weight[j] ?? 0;
    if (w > 1e-3) out[j] = (out[j] ?? 0) / w;
  }
  return out.subarray(0, target);
}
