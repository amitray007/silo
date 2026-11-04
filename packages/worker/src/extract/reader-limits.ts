import { availableParallelism } from 'node:os';

/** The deadline every page gets; only pages heavy enough to need more get more. */
export const READER_BASE_TIMEOUT_MS = 5_000;
/** The deadline no page exceeds, so a pathological page still ends and frees its thread. */
export const READER_MAX_TIMEOUT_MS = 20_000;
/** Reader time grows with the DOM, not the file: measured ~0.4-0.6 ms per element. */
const MS_PER_ELEMENT = 1;
/** A flat per-byte allowance covers text-heavy pages with few elements (~0.5 s per MB measured). */
const MS_PER_KB = 4;

const MIN_THREADS = 1;
const MAX_THREADS = 8;
const AUTO_MAX_THREADS = 3;

/** Opening tags, counted without parsing: the cost driver of the Reader's DOM work. */
export function countElements(html: string): number {
  let count = 0;
  for (let at = html.indexOf('<'); at !== -1; at = html.indexOf('<', at + 1)) {
    const next = html.charCodeAt(at + 1) | 32;
    if (next >= 97 && next <= 122) count++;
  }
  return count;
}

/**
 * The Reader deadline for one page: the 5 s base plus 1 ms per element and 4 ms per KB, capped at
 * 20 s. Every measured page took under half of its allowance. Small pages keep exactly 5 s.
 */
export function readerTimeoutMs(html: string): number {
  const scaled =
    READER_BASE_TIMEOUT_MS +
    countElements(html) * MS_PER_ELEMENT +
    (html.length / 1024) * MS_PER_KB;
  return Math.min(READER_MAX_TIMEOUT_MS, Math.round(scaled));
}

/**
 * How many Reader threads to run: one fewer than the CPUs (the worker's main thread needs one),
 * between 1 and 3. `SILO_READER_THREADS` (an integer 1 to 8) overrides it; anything else warns
 * and keeps the default.
 */
export function readerThreadCount(
  env: NodeJS.ProcessEnv = process.env,
  cpus: number = availableParallelism(),
): number {
  const fallback = Math.min(Math.max(cpus - 1, MIN_THREADS), AUTO_MAX_THREADS);
  const raw = env.SILO_READER_THREADS?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= MIN_THREADS && parsed <= MAX_THREADS) return parsed;
  console.warn(
    `[silo/worker] SILO_READER_THREADS="${raw}" must be an integer from ${MIN_THREADS} to ${MAX_THREADS} — falling back to the default (${fallback}).`,
  );
  return fallback;
}
