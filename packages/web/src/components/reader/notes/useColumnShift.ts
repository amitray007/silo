import { animate } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSidebarControl } from '../../SidebarControlContext';
import { measureGeometry, type Plan, planColumn } from './plan';

/** The spring the column moves on: a transform, never the width. */
const SPRING = { type: 'spring', stiffness: 260, damping: 32, mass: 1 } as const;
/** The article's right padding when the lane has not changed it. */
const DEFAULT_PADDING = 32;
/** If the layout never settles after a sidebar collapse, carry on after this long. */
const COLLAPSE_SETTLE_MS = 600;

function samePlan(a: Plan | null, b: Plan | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.extra === b.extra &&
    a.shift === b.shift &&
    a.hideDial === b.hideDial &&
    a.overlay === b.overlay &&
    a.needsCollapse === b.needsCollapse &&
    a.proseRight === b.proseRight
  );
}

/** The element to hold still across a reflow, with where it sits now. */
function pinAnchor(prose: HTMLElement, scroll: HTMLElement, preferred: Element | null) {
  const box = scroll.getBoundingClientRect();
  const target =
    preferred ??
    Array.from(prose.children).find(
      (child) => child.getBoundingClientRect().bottom > box.top + 80,
    ) ??
    null;
  return target ? { el: target, top: target.getBoundingClientRect().top } : null;
}

/** Move the column to `-shift` px: on the spring, or at once under reduced motion. */
function moveColumn(article: HTMLElement, x: number, reduced: boolean) {
  if (reduced) {
    article.style.transform = x ? `translateX(${x}px)` : '';
    return null;
  }
  if (x === 0 && !article.style.transform) return null;
  const running = animate(article, { x }, SPRING);
  running.then(() => {
    if (x === 0) article.style.transform = '';
  });
  return running;
}

export type ColumnShift = {
  plan: Plan | null;
  /** The lane sits beside the column. */
  stacked: boolean;
  /** The lane is a panel over the pane. */
  overlay: boolean;
};

/**
 * Makes room for the notes lane. Opening it moves the article column left on a spring, just
 * enough; if the pane is too narrow it collapses the app sidebar (and restores it on close, only
 * if the lane collapsed it); below that, the lane becomes an overlay panel. The paragraph the
 * reader is looking at stays where it is.
 */
export function useColumnShift({
  prose,
  scroll,
  open,
  anchor,
  reduced,
  onDialHidden,
}: {
  prose: HTMLElement;
  scroll: HTMLElement;
  open: boolean;
  /** The element to keep in place across the reflow, if there is a preferred one. */
  anchor: () => Element | null;
  reduced: boolean;
  onDialHidden: (hidden: boolean) => void;
}): ColumnShift {
  const article = prose.closest<HTMLElement>('.silo-reader');
  const { collapsed, setCollapsed, freedWidth } = useSidebarControl();
  const [tick, setTick] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [collapsing, setCollapsing] = useState(false);
  const applied = useRef(0);
  const base = useRef<number | null>(null);
  const collapsedByLane = useRef(false);
  const [declined, setDeclined] = useState(false);
  const latest = useRef({ anchor, onDialHidden });
  latest.current = { anchor, onDialHidden };

  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(prose);
    observer.observe(scroll);
    // Content above the prose (a wrapping title, a note card) moves it without resizing it.
    if (article) observer.observe(article);
    document.fonts?.addEventListener('loadingdone', bump);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', bump);
    };
  }, [prose, scroll, article]);

  // Where the column would sit, and whether the sidebar collapsing would make the lane fit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick, collapsed and declined re-read the layout after it changes.
  useLayoutEffect(() => {
    if (!article) return;
    if (base.current === null)
      base.current = Number.parseFloat(getComputedStyle(article).paddingRight) || DEFAULT_PADDING;
    let next = planColumn(measureGeometry(article, prose, scroll, applied.current, 0), open);
    if (open && next.overlay && !collapsed && !declined) {
      const delta = freedWidth();
      if (delta > 0) {
        const wider = planColumn(
          measureGeometry(article, prose, scroll, applied.current, delta),
          open,
        );
        if (!wider.overlay) next = { ...next, needsCollapse: true };
      }
    }
    setPlan((previous) => (samePlan(previous, next) ? previous : next));
  }, [article, prose, scroll, open, collapsed, declined, tick, freedWidth]);

  // Borrow the sidebar's room while the lane needs it; give it back after, but only if the lane
  // was what collapsed it. If the reader opens it again meanwhile, the lane stays an overlay.
  const needsCollapse = Boolean(plan?.needsCollapse);
  useEffect(() => {
    if (open && needsCollapse && !collapsedByLane.current && !declined) {
      collapsedByLane.current = true;
      setCollapsing(true);
      setCollapsed(true);
      return;
    }
    if (!open && collapsedByLane.current) {
      collapsedByLane.current = false;
      setCollapsing(false);
      setCollapsed(false);
    }
    if (!open) setDeclined(false);
  }, [open, needsCollapse, declined, setCollapsed]);
  useEffect(() => {
    if (collapsed || !collapsedByLane.current || collapsing) return;
    collapsedByLane.current = false;
    setDeclined(true);
  }, [collapsed, collapsing]);
  // The collapse finishes when the pane has re-laid out: wait for the next frames, or give up.
  useEffect(() => {
    if (!collapsing || !collapsed) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setCollapsing(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [collapsing, collapsed]);
  useEffect(() => {
    if (!collapsing) return;
    const timer = window.setTimeout(() => setCollapsing(false), COLLAPSE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [collapsing]);
  useEffect(
    () => () => {
      if (!collapsedByLane.current) return;
      collapsedByLane.current = false;
      setCollapsed(false);
    },
    [setCollapsed],
  );

  // Apply the plan: padding now, the shift on a spring.
  const extra = plan?.extra ?? 0;
  const shift = plan?.shift ?? 0;
  const hideDial = Boolean(plan?.hideDial) && open;
  const ready = plan !== null;
  const controls = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    if (!article || base.current === null || !ready) return;
    const pinned = pinAnchor(prose, scroll, latest.current.anchor());
    applied.current = extra;
    article.style.paddingRight = extra ? `${base.current + extra}px` : '';
    controls.current?.stop();
    controls.current = moveColumn(article, -shift, reduced);
    latest.current.onDialHidden(hideDial);
    // Keep the paragraph where it was after the reflow. The anchor is measured now, before this
    // plan's padding lands, so a scroll since the lane opened is never undone.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!pinned) return;
        const delta = pinned.el.getBoundingClientRect().top - pinned.top;
        if (Math.abs(delta) > 1) scroll.scrollTop += delta;
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [article, prose, ready, extra, shift, hideDial, reduced, scroll]);
  useEffect(
    () => () => {
      controls.current?.stop();
      latest.current.onDialHidden(false);
      if (article) {
        article.style.transform = '';
        article.style.paddingRight = '';
      }
    },
    [article],
  );

  const settled = open && plan && !plan.needsCollapse && !collapsing;
  return {
    plan,
    stacked: Boolean(settled && !plan.overlay),
    overlay: Boolean(settled && plan.overlay),
  };
}
