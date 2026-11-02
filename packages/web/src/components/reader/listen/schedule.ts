import type { Unit } from './speechPlan';

/** Seconds between "now" and the first sample after an underrun. */
export const START_LEAD = 0.02;

/** The audio clock time a buffer starts at: right after the last one, or just ahead of now. */
export function startTime(nextTime: number, now: number): number {
  return Math.max(nextTime, now + START_LEAD);
}

/** When each sentence of a unit begins, spreading the unit's duration over its text share. */
export function sentenceTimes(
  unit: Unit,
  start: number,
  duration: number,
): { at: number; seg: number }[] {
  const total = unit.parts.reduce((sum, part) => sum + part.chars, 0) || 1;
  let before = 0;
  return unit.parts.map((part) => {
    const entry = { at: start + (duration * before) / total, seg: part.seg };
    before += part.chars;
    return entry;
  });
}

/** The sentence playing at `now`, or -1 before the first one starts. */
export function sentenceAtTime(
  timeline: readonly { at: number; seg: number }[],
  now: number,
): number {
  let seg = -1;
  for (const entry of timeline) if (entry.at <= now) seg = entry.seg;
  return seg;
}

/** Roughly how many characters a voice speaks per second at 1x, to size lookahead. */
export const CHARS_PER_SECOND = 15;
/** Keep about this many seconds synthesized ahead of the unit that is playing. */
export const LOOKAHEAD_SECONDS = 20;
export const LOOKAHEAD_UNITS = 3;
/** Never run more than this many units ahead. */
export const MAX_AHEAD = 12;

/** True when enough audio is already requested past the unit that is playing. */
export function aheadEnough(seconds: number, units: number): boolean {
  return seconds >= LOOKAHEAD_SECONDS && units >= LOOKAHEAD_UNITS;
}
