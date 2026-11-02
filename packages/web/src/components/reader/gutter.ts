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
export function gutterLeft(
  frame: HTMLElement,
  scroll: HTMLElement,
  { size, gap, edge }: Gutter,
): number {
  const inset = frame.getBoundingClientRect().left - scroll.getBoundingClientRect().left;
  return Math.min(frame.clientWidth + gap, scroll.clientWidth - inset - size - edge);
}

/** The gutter for this window. Geometry is read by its controls before paint. */
export function useGutter(): Gutter {
  return useMediaQuery(layoutMedia.phone) ? PHONE_GUTTER : DESKTOP_GUTTER;
}
