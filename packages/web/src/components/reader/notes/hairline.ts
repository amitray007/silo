import { LANE_GAP } from './plan';
import type { Slot } from './stack';

/** Read the connector before layout writes, accounting for its group's pending move and scroll cap. */
export function hairlinePath(
  frame: HTMLElement,
  target: HTMLElement,
  range: Range,
  gutterOffset: number,
  next?: Map<string, Slot>,
  rangeY?: number,
): string {
  const scroller = target.closest<HTMLElement>('.silo-lgroup-scroll');
  const group = scroller?.parentElement;
  if (!scroller || !group) return '';
  const origin = frame.getBoundingClientRect().top + frame.clientTop - frame.scrollTop;
  const rect = target.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const slot = next?.get(group.dataset.group ?? '');
  const delta = slot ? slot.top - (group.getBoundingClientRect().top - origin) : 0;
  // Growing the viewport can clamp scrollTop before paint, moving the block down within its group.
  const clamped = slot
    ? Math.max(0, scroller.scrollTop - Math.max(0, scroller.scrollHeight - slot.height))
    : 0;
  const top = rect.top + delta + clamped;
  const viewTop = view.top + delta;
  if (top + rect.height < viewTop + 4 || top > viewTop + (slot?.height ?? view.height) - 4)
    return '';
  if (rangeY === undefined) {
    const fragment = range.getClientRects()[0] ?? range.getBoundingClientRect();
    rangeY = fragment.top + fragment.height / 2 - origin;
  }
  const y2 = top - origin + 12;
  const x1 = frame.clientWidth + gutterOffset;
  const x2 = frame.clientWidth + LANE_GAP - 6;
  const mid = (x1 + x2) / 2;
  return `M${x1} ${rangeY}C${mid} ${rangeY} ${mid} ${y2} ${x2} ${y2}`;
}
