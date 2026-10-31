import { useEffect, useState } from 'react';
import { layoutMedia, useMediaQuery } from '../../lib/breakpoints';

/**
 * The right gutter column beside the prose. The resume button and the note markers share it:
 * a control is `size` wide, `gap` past the prose and at least `edge` inside the pane's edge. On
 * a phone the article's right padding is 20px, so controls shrink to 20px and fill it.
 */
export type Gutter = { size: number; gap: number; edge: number };
const DESKTOP_GUTTER: Gutter = { size: 24, gap: 6, edge: 4 };
const PHONE_GUTTER: Gutter = { size: 20, gap: 0, edge: 0 };

/**
 * Where the gutter column starts, in the prose frame's own coordinates: just past the prose,
 * pulled in when the pane is too narrow to leave room.
 */
function useGutterLeft(
  frame: HTMLElement | null,
  scroll: HTMLElement | null,
  { size, gap, edge }: Gutter,
): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!frame || !scroll) return;
    const place = () => {
      const inset = frame.getBoundingClientRect().left - scroll.getBoundingClientRect().left;
      setLeft(Math.min(frame.clientWidth + gap, scroll.clientWidth - inset - size - edge));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(frame);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [frame, scroll, size, gap, edge]);
  return left;
}

/** The gutter for this window and the x its controls share. */
export function useGutter(
  frame: HTMLElement | null,
  scroll: HTMLElement | null,
): { gutter: Gutter; left: number } {
  const gutter = useMediaQuery(layoutMedia.phone) ? PHONE_GUTTER : DESKTOP_GUTTER;
  return { gutter, left: useGutterLeft(frame, scroll, gutter) };
}
