import type { Slot } from './stack';

/** Mount half a screen ahead of scrolling, including groups explicitly reached by a marker or Tab. */
export function laneWindow(
  slots: ReadonlyMap<string, Slot>,
  top: number,
  height: number,
  pinned: readonly string[] = [],
): string[] {
  const buffer = height > 0 ? Math.max(400, height / 2) : 800;
  const keep = new Set(pinned);
  return [...slots]
    .filter(
      ([key, slot]) =>
        keep.has(key) ||
        (slot.top + slot.height >= top - buffer && slot.top <= top + height + buffer),
    )
    .map(([key]) => key);
}
