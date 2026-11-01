import { useLayoutEffect, useRef } from 'react';

type Space = { original: string; base: number; extra: number };

function normalGap(target: HTMLElement | undefined, spaces: Map<HTMLElement, Space>): number {
  if (!target) return 0;
  const previous = target.previousElementSibling?.getBoundingClientRect();
  const value = spaces.get(target);
  return previous && value ? target.getBoundingClientRect().top + value.base - previous.bottom : 0;
}

function paintSpaces(
  spaces: Map<HTMLElement, Space>,
  starts: Map<HTMLElement, number>,
  target: HTMLElement | undefined,
  extra: number,
  eased: number,
): void {
  for (const [el, space] of spaces) {
    const from = starts.get(el) ?? 0;
    space.extra = from + ((el === target ? extra : 0) - from) * eased;
    el.style.paddingTop = `${space.base + space.extra}px`;
  }
}

/** Borrow paragraph space for the label; preserve the first visible text's screen position. */
export function usePlaceSpacing(
  block: Element | undefined,
  paragraphs: readonly Element[],
  scroll: HTMLElement,
  measure: () => void,
) {
  const spacing = useRef(new Map<HTMLElement, Space>());
  const afterLayout = useRef(measure);
  afterLayout.current = measure;
  useLayoutEffect(() => {
    const original = scroll.style.overflowAnchor;
    scroll.style.overflowAnchor = 'none';
    const spaces = spacing.current;
    return () => {
      scroll.style.overflowAnchor = original;
      for (const [el, value] of spaces) el.style.paddingTop = value.original;
      spaces.clear();
    };
  }, [scroll]);

  useLayoutEffect(() => {
    const spaces = spacing.current;
    const target = block instanceof HTMLElement ? block : undefined;
    if (target && !spaces.has(target))
      spaces.set(target, {
        original: target.style.paddingTop,
        base: Number.parseFloat(getComputedStyle(target).paddingTop) || 0,
        extra: 0,
      });
    const extra = Math.max(0, 38 - normalGap(target, spaces));
    const starts = new Map([...spaces].map(([el, space]) => [el, space.extra]));
    const viewport = scroll.getBoundingClientRect().top;
    const anchor = paragraphs.find((el) => el.getBoundingClientRect().bottom > viewport);
    const contentTop = (el: Element) =>
      el.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(el).paddingTop) || 0);
    const anchored = anchor ? contentTop(anchor) : 0;
    const start = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const tick = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - start) / 200);
      const eased = 1 - (1 - progress) ** 3;
      paintSpaces(spaces, starts, target, extra, eased);
      if (anchor) scroll.scrollTop += contentTop(anchor) - anchored;
      // Paint in this animation callback, after padding and scroll anchoring.
      afterLayout.current();
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    if (reduced) tick(start);
    else frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [block, paragraphs, scroll]);
}
