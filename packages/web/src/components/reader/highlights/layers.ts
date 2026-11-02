/** Where the last Option-click landed, and which layer it chose. */
export type CycleMemory = { x: number; y: number; at: number; index: number };

/** A repeat click this close, this soon, continues the cycle. */
const SAME_SPOT_PX = 6;
const SAME_SPOT_MS = 4000;

/**
 * Option-click walks the layers under the pointer, innermost to outermost, and wraps. A click
 * within 6px of the last one, within 4 seconds, takes the next layer; anything else starts over.
 */
export function nextLayer(
  last: CycleMemory | null,
  point: { x: number; y: number },
  count: number,
  now: number,
): { index: number; memory: CycleMemory } {
  const same =
    last !== null &&
    Math.hypot(last.x - point.x, last.y - point.y) < SAME_SPOT_PX &&
    now - last.at < SAME_SPOT_MS;
  const index = same ? (last.index + 1) % count : 0;
  return { index, memory: { x: point.x, y: point.y, at: now, index } };
}
