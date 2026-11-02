/** Ribbon and first-line label in the positioned prose frame's coordinates. */
export function ribbonPosition(block: Element, frame: HTMLElement) {
  const rect = block.getBoundingClientRect();
  const css = getComputedStyle(block);
  const box = frame.getBoundingClientRect();
  const lineTop =
    rect.top + Number.parseFloat(css.paddingTop) + Number.parseFloat(css.borderTopWidth);
  const lineHeight = Number.parseFloat(css.lineHeight);
  const left = rect.left + Number.parseFloat(css.paddingLeft);
  return {
    top: lineTop + (lineHeight - 24) / 2 - box.top - frame.clientTop + frame.scrollTop,
    left: left - box.left - frame.clientLeft + frame.scrollLeft - 30,
    row: lineTop - 20 - box.top - frame.clientTop + frame.scrollTop,
    width: rect.width - Number.parseFloat(css.paddingLeft) - Number.parseFloat(css.paddingRight),
    elbowX: Math.round((left - 18) * devicePixelRatio) / devicePixelRatio - (left - 30),
    elbowY:
      Math.round((lineTop - 12) * devicePixelRatio) / devicePixelRatio -
      (lineTop + (lineHeight - 24) / 2),
  };
}

/** Only actual text fragments on a paragraph's first line reveal a manual mark. */
export function withinFirstLine(block: Element, x: number, y: number): boolean {
  const range = document.createRange();
  range.selectNodeContents(block);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 1 && rect.height > 1,
  );
  const first = rects[0];
  return Boolean(
    first &&
      rects.some(
        (rect) =>
          Math.abs(rect.top - first.top) < 3 &&
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom,
      ),
  );
}

/** Clip a 46px window out of the dial, including its pointer hit areas. */
export function dialClip(box: DOMRect, ribbons: readonly DOMRect[]): string {
  const windows = ribbons
    .filter((rect) => rect.left < box.right && rect.right > box.left)
    .map((rect) => ({
      top: Math.max(0, rect.top + rect.height / 2 - box.top - 23),
      bottom: Math.min(box.height, rect.top + rect.height / 2 - box.top + 23),
    }))
    .filter((rect) => rect.top < rect.bottom)
    .sort((a, b) => a.top - b.top);
  const merged: typeof windows = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous && window.top <= previous.bottom)
      previous.bottom = Math.max(previous.bottom, window.bottom);
    else merged.push({ ...window });
  }
  const cuts = merged
    .map(({ top, bottom }) => `M 0 ${top} H ${box.width} V ${bottom} H 0 Z`)
    .join(' ');
  return merged.length
    ? `path(evenodd, "M 0 0 H ${box.width} V ${box.height} H 0 Z ${cuts}")`
    : 'none';
}
