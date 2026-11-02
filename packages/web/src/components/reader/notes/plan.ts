/** The lane is 264px wide, with the gutter markers in the first part of a 52px gap before it. */
export const LANE = 264;
export const LANE_GAP = 52;
const EDGE = 12;
const NEED = LANE_GAP + LANE + EDGE;
const MIN_COLUMN = 560;
/** The outline dial's rail, and the room it keeps from the column. */
const RAIL = 56;

/** How the column makes room for the lane. All numbers are pixels. */
export type Plan = {
  /** Extra right padding on the article: the column narrows by this much. */
  extra: number;
  /** How far the column moves left. */
  shift: number;
  /** The outline dial would collide with the shifted column. */
  hideDial: boolean;
  /** Nothing fits: the lane is a panel over the pane and the markers hide. */
  overlay: boolean;
  /** It would fit if the app sidebar collapsed. */
  needsCollapse?: boolean;
  /** The prose's natural right edge, minus `extra`, in the scroll area's coordinates. */
  proseRight: number;
};

/** The column's natural (untransformed) geometry. */
export type Geometry = {
  /** The prose's left edge. */
  left: number;
  /** The prose's width. */
  width: number;
  /** The prose's right edge. */
  proseRight: number;
  /** The scroll area's client width. */
  room: number;
};

/**
 * The column's geometry in the scroll area's coordinates, with any transform and padding the lane
 * applied taken out. With `delta` it answers for a pane that much wider (the sidebar collapsed),
 * where the article re-centres up to its max width.
 */
export function measureGeometry(
  article: HTMLElement,
  prose: HTMLElement,
  scroll: HTMLElement,
  applied: number,
  delta: number,
): Geometry {
  const a = article.getBoundingClientRect();
  const p = prose.getBoundingClientRect();
  const inset = p.left - a.left;
  const width = p.width + applied;
  if (!delta) {
    return {
      left: article.offsetLeft + inset,
      width,
      proseRight: article.offsetLeft + (p.right - a.left) + applied,
      room: scroll.clientWidth,
    };
  }
  const room = scroll.clientWidth + delta;
  const max = Number.parseFloat(getComputedStyle(article).maxWidth) || article.offsetWidth;
  const rightInset = a.right - p.right - applied;
  const articleWidth = Math.min(max, room);
  const left = (room - articleWidth) / 2 + inset;
  const proseWidth = articleWidth - inset - rightInset;
  return { left, width: proseWidth, proseRight: left + proseWidth, room };
}

const CLOSED: Plan = { extra: 0, shift: 0, hideDial: false, overlay: false, proseRight: 0 };

/** Work out how the column makes room for the lane. */
export function planColumn(g: Geometry, open: boolean): Plan {
  if (!open) return { ...CLOSED, proseRight: g.proseRight };
  const { left, width, proseRight } = g;
  const need = Math.max(0, NEED - (g.room - proseRight));
  const withDial = left - RAIL - 4;
  const noDial = left - 16;
  if (need <= withDial) return { ...CLOSED, shift: need, proseRight };
  if (need <= noDial) return { ...CLOSED, shift: need, hideDial: true, proseRight };
  const shift = Math.max(0, noDial);
  const extra = need - shift;
  if (width - extra < MIN_COLUMN) return { ...CLOSED, overlay: true, proseRight };
  return { extra, shift, hideDial: true, overlay: false, proseRight: proseRight - extra };
}
