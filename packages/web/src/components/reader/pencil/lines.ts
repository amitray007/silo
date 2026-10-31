/** One visual line of article text, in the coordinates of the frame that holds the prose. */
export type Line = {
  top: number;
  left: number;
  width: number;
  height: number;
  /** The share of the block's words that sit on this line. */
  words: number;
  block: Element;
};

/** Text the pencil never sweeps: code, figures and captions, tables, math, controls, notes. */
export const SKIP_SELECTOR =
  'pre, figure, figcaption, caption, table, math, svg, script, style, button, .silo-reader-card, [aria-hidden="true"], a[title="return to article"]';

export const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, dd, dt, div';

/** Visible prose text nodes in document order, minus code, figures and tables. */
export function proseTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (parent && text.data.trim() && !parent.closest(SKIP_SELECTOR)) nodes.push(text);
  }
  return nodes;
}

function visibleRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1);
}

/** Fold a fragment into the previous line when it sits on the same line of the same block. */
function joinLine(last: Line | undefined, block: Element, fragment: Line): boolean {
  if (!last || last.block !== block) return false;
  const centre = fragment.top + fragment.height / 2;
  if (centre <= last.top || centre >= last.top + last.height) return false;
  const right = Math.max(last.left + last.width, fragment.left + fragment.width);
  last.left = Math.min(last.left, fragment.left);
  last.width = right - last.left;
  last.words += fragment.words;
  return true;
}

/**
 * Group the prose text fragments into visual lines with `Range.getClientRects()`. The frame
 * is the positioned element the pencil draws in, so lines keep their place as the page scrolls.
 */
export function measureLines(root: HTMLElement, frame: HTMLElement): Line[] {
  const origin = frame.getBoundingClientRect();
  const lines: Line[] = [];
  const range = document.createRange();
  for (const node of proseTextNodes(root)) {
    range.selectNodeContents(node);
    const rects = visibleRects(range);
    const total = rects.reduce((sum, rect) => sum + rect.width, 0);
    const words = node.data.trim().split(/\s+/).length;
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? root;
    for (const rect of rects) {
      const fragment: Line = {
        top: rect.top - origin.top,
        left: rect.left - origin.left,
        width: rect.width,
        height: rect.height,
        words: (words * rect.width) / total,
        block,
      };
      if (!joinLine(lines.at(-1), block, fragment)) lines.push(fragment);
    }
  }
  return lines;
}

/** Words before each line, with the article's total last: `prefix[i]` is the words above line i. */
export function wordPrefix(lines: readonly Line[]): number[] {
  const prefix: number[] = [];
  let sum = 0;
  for (const line of lines) {
    prefix.push(sum);
    sum += line.words;
  }
  prefix.push(sum);
  return prefix;
}

/** The share (0 to 1) of the article's words above a point `sweep` of the way along a line. */
export function shareAt(
  lines: readonly Line[],
  prefix: readonly number[],
  index: number,
  sweep: number,
): number {
  const total = prefix.at(-1) ?? 0;
  const line = lines[index];
  if (!line || total <= 0) return 0;
  return Math.min(1, Math.max(0, ((prefix[index] ?? 0) + line.words * sweep) / total));
}

/** The line and how far along it a share of the words falls. */
export function pointAtShare(
  lines: readonly Line[],
  prefix: readonly number[],
  share: number,
): { index: number; sweep: number } {
  const total = prefix.at(-1) ?? 0;
  if (!lines.length || total <= 0) return { index: 0, sweep: 0 };
  const target = total * Math.min(1, Math.max(0, share));
  const found = lines.findIndex((_, i) => (prefix[i + 1] ?? 0) > target);
  if (found < 0) return { index: lines.length - 1, sweep: 1 };
  const line = lines[found];
  const sweep = line && line.words > 0 ? (target - (prefix[found] ?? 0)) / line.words : 0;
  return { index: found, sweep: Math.min(1, Math.max(0, sweep)) };
}

/** Seconds the pencil spends on a line at a pace. A very short line still takes a moment. */
export function lineSeconds(line: Line, wpm: number): number {
  return Math.max(0.3, (line.words / wpm) * 60);
}

/** Move the sweep forward by `seconds`, crossing line ends. `ended` is true at the last line's end. */
export function advance(
  lines: readonly Line[],
  from: { index: number; sweep: number },
  seconds: number,
  wpm: number,
): { index: number; sweep: number; ended: boolean } {
  let { index, sweep } = from;
  let left = seconds;
  for (;;) {
    const line = lines[index];
    if (!line) return { index, sweep, ended: true };
    const remaining = (1 - sweep) * lineSeconds(line, wpm);
    if (left < remaining)
      return { index, sweep: sweep + left / lineSeconds(line, wpm), ended: false };
    left -= remaining;
    if (index >= lines.length - 1) return { index, sweep: 1, ended: true };
    index += 1;
    sweep = 0;
  }
}

/** The line nearest a y position (frame coordinates), if one is within `reach` pixels. */
export function lineNear(lines: readonly Line[], y: number, reach = 24): number {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  lines.forEach((line, i) => {
    const d = Math.abs(line.top + line.height / 2 - y);
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return distance < reach ? best : -1;
}
