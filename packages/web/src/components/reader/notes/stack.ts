/** Space between two groups in the lane, and between two blocks inside a group. */
export const GROUP_GAP = 12;
export const BLOCK_GAP = 8;
/** A group is never shorter than this cap, even beside a one-line paragraph. */
const MIN_GROUP_MAX = 112;

export type StackRow = {
  key: string;
  /** Where the group wants to sit: the top of its paragraph. */
  anchor: number;
  /** The tallest the group may grow before it scrolls inside itself. */
  max: number;
  /** The measured height of each block. */
  blocks: readonly number[];
};

export type Slot = { top: number; max: number; height: number };

/** A group is as tall as its blocks, up to its cap. */
export function groupHeight(blocks: readonly number[], max: number): number {
  const content = blocks.reduce((sum, height) => sum + height, 0) + BLOCK_GAP * (blocks.length - 1);
  return Math.min(Math.max(0, content), max);
}

/** The cap for a group beside a paragraph that is `paragraphHeight` tall. */
export function groupMax(paragraphHeight: number): number {
  return Math.max(paragraphHeight, MIN_GROUP_MAX);
}

/**
 * Put each group at its anchor, pushed down so it never touches the group above. Heights are the
 * measured block heights, so one pass is enough: nothing here reads the DOM.
 */
export function stackRows(rows: readonly StackRow[], start = Number.NEGATIVE_INFINITY) {
  const slots = new Map<string, Slot>();
  let floor = start;
  for (const row of [...rows].sort((a, b) => a.anchor - b.anchor)) {
    const top = Math.max(row.anchor, floor);
    const height = groupHeight(row.blocks, row.max);
    slots.set(row.key, { top, max: row.max, height });
    floor = top + height + GROUP_GAP;
  }
  return slots;
}

/** True when two slots, as laid out, overlap. The dev assertion and the tests share it. */
export function slotsOverlap(a: Pick<Slot, 'top' | 'height'>, b: Pick<Slot, 'top' | 'height'>) {
  return a.top < b.top + b.height - 1 && b.top < a.top + a.height - 1;
}
