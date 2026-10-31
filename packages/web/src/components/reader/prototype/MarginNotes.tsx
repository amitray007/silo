// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReaderIcon } from '../ReaderIcon';
import { ProtoIcon } from './ProtoIcon';
import { paragraphNumber } from './paragraphs.prototype';
import type { PassageHighlight } from './useHighlights';

const LANE = 264;
const LANE_GAP = 52; // gutter markers sit in the first part of this gap
const EDGE = 12;
const NEED = LANE_GAP + LANE + EDGE;
const MARKER_GUTTER = 48;
const MIN_COLUMN = 560;
const RAIL = 56;
const SPRING = { type: 'spring', stiffness: 260, damping: 32, mass: 1 } as const;

type Plan = {
  extra: number; // extra right padding on the article: gutter reserve or narrowing
  shift: number; // how far the column moves left
  hideDial: boolean;
  overlay: boolean;
  proseRight: number; // natural prose right edge, minus `extra`
};

type Group = {
  para: number;
  ids: string[];
  items: PassageHighlight[];
  y: number; // centre of the first noted line
  colors: string[];
};

/** Work out how the column makes room for the lane, from natural (untransformed) geometry. */
function planColumn(
  article: HTMLElement,
  prose: HTMLElement,
  scroll: HTMLElement,
  applied: number,
  base: number,
  open: boolean,
  has: boolean,
): Plan {
  const a = article.getBoundingClientRect();
  const p = prose.getBoundingClientRect();
  const left = article.offsetLeft + (p.left - a.left);
  const width = p.width + applied;
  const proseRight0 = article.offsetLeft + (p.right - a.left) + applied;
  const free = scroll.clientWidth - proseRight0;
  const reserve = has ? Math.max(0, MARKER_GUTTER - free) : 0;
  if (!(open && has))
    return {
      extra: reserve,
      shift: 0,
      hideDial: false,
      overlay: false,
      proseRight: proseRight0 - reserve,
    };
  void base;
  const need = Math.max(0, NEED - free);
  const withDial = left - RAIL - 4;
  const noDial = left - 16;
  if (need <= withDial)
    return { extra: 0, shift: need, hideDial: false, overlay: false, proseRight: proseRight0 };
  if (need <= noDial)
    return { extra: 0, shift: need, hideDial: true, overlay: false, proseRight: proseRight0 };
  const shift = Math.max(0, noDial);
  const extra = need - shift;
  if (width - extra < MIN_COLUMN)
    return {
      extra: reserve,
      shift: 0,
      hideDial: false,
      overlay: true,
      proseRight: proseRight0 - reserve,
    };
  return { extra, shift, hideDial: true, overlay: false, proseRight: proseRight0 - extra };
}

/**
 * Notes in the margin. Closed: one small pill per paragraph in a fixed gutter column. Open: the
 * column shifts left on a spring and a lane holds every note, each beside its passage.
 */
export function MarginNotes({
  items,
  prose,
  scroll,
  host,
  panel,
  open,
  focusId,
  hoveredIds,
  setHoveredIds,
  onMarker,
  onFocus,
  onClose,
  onEdit,
  onRemove,
  onDialHidden,
}: {
  items: PassageHighlight[];
  prose: HTMLElement | null;
  scroll: HTMLElement;
  host: HTMLElement;
  panel: HTMLElement;
  open: boolean;
  focusId: string | null;
  hoveredIds: string[];
  setHoveredIds: (ids: string[]) => void;
  onMarker: (ids: string[]) => void;
  onFocus: (id: string) => void;
  onClose: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onDialHidden: (hidden: boolean) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [tick, setTick] = useState(0);
  const [tops, setTops] = useState<Record<string, number>>({});
  const lane = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const applied = useRef(0);
  const base = useRef<number | null>(null);
  const shifted = useRef(0);
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  const noted = useMemo(() => items.filter((entry) => entry.note), [items]);
  const has = noted.length > 0;
  const article = prose?.closest<HTMLElement>('.silo-reader') ?? null;

  useEffect(() => {
    if (!prose) return;
    const bump = () => setTick((value) => value + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(prose);
    observer.observe(scroll);
    document.fonts?.addEventListener('loadingdone', bump);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', bump);
    };
  }, [prose, scroll]);

  // Remember the paragraph the reader is looking at, so a reflow does not move it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: capture when the lane toggles.
  useLayoutEffect(() => {
    if (!prose) return;
    const box = scroll.getBoundingClientRect();
    const focused = noted.find((entry) => entry.id === focusId);
    const el = focused ? focused.range.startContainer.parentElement : null;
    const target =
      el ??
      Array.from(prose.children).find(
        (child) => child.getBoundingClientRect().bottom > box.top + 80,
      ) ??
      null;
    anchor.current = target ? { el: target, top: target.getBoundingClientRect().top } : null;
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-reads geometry after layout changes.
  const plan = useMemo<Plan | null>(() => {
    if (!article || !prose) return null;
    if (base.current === null)
      base.current = Number.parseFloat(getComputedStyle(article).paddingRight) || 32;
    return planColumn(article, prose, scroll, applied.current, base.current, open, has);
  }, [article, prose, scroll, open, has, tick]);

  // Apply the plan: padding (narrowing / gutter) now, the shift on a spring.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onDialHidden is stable enough for a prototype.
  useEffect(() => {
    if (!article || !plan || base.current === null) return;
    applied.current = plan.extra;
    article.style.paddingRight = plan.extra ? `${base.current + plan.extra}px` : '';
    const target = -plan.shift;
    const targets = [article, wrap.current].filter(Boolean) as HTMLElement[];
    for (const el of targets) {
      if (reduced) el.style.transform = target ? `translateX(${target}px)` : '';
      else animate(el, { x: target }, SPRING);
    }
    shifted.current = plan.shift;
    onDialHidden(plan.hideDial && open);
    // Keep the paragraph where it was after the reflow.
    const held = anchor.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!held) return;
        const delta = held.el.getBoundingClientRect().top - held.top;
        if (Math.abs(delta) > 1) scroll.scrollTop += delta;
        anchor.current = { el: held.el, top: held.el.getBoundingClientRect().top };
      }),
    );
    return () => {
      article.style.paddingRight = '';
    };
  }, [article, plan, reduced, scroll, open]);

  useEffect(
    () => () => {
      if (article) {
        article.style.transform = '';
        article.style.paddingRight = '';
      }
    },
    [article],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-measures after layout changes.
  const groups = useMemo<Group[]>(() => {
    if (!prose) return [];
    const box = scroll.getBoundingClientRect();
    const byPara = new Map<number, Group>();
    for (const item of noted) {
      const rect = item.range.getClientRects()[0] ?? item.range.getBoundingClientRect();
      const para = paragraphNumber(prose, item.range.startContainer);
      const y = rect.top + rect.height / 2 - box.top + scroll.scrollTop;
      const group = byPara.get(para) ?? { para, ids: [], items: [], y, colors: [] };
      group.ids.push(item.id);
      group.items.push(item);
      group.y = Math.min(group.y, y);
      if (!group.colors.includes(item.color)) group.colors.push(item.color);
      byPara.set(para, group);
    }
    return [...byPara.values()].sort((a, b) => a.y - b.y);
  }, [noted, prose, scroll, tick, plan]);

  // Lane layout: each note at its passage's top, pushed down to avoid overlap.
  const stacked = open && plan && !plan.overlay;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-stack when notes or geometry change.
  useLayoutEffect(() => {
    if (!stacked || !lane.current) return;
    const next: Record<string, number> = {};
    let floor = Number.NEGATIVE_INFINITY;
    const box = scroll.getBoundingClientRect();
    for (const item of noted) {
      const rect = item.range.getClientRects()[0] ?? item.range.getBoundingClientRect();
      const y = rect.top - box.top + scroll.scrollTop - 2;
      const el = lane.current.querySelector<HTMLElement>(`[data-note="${item.id}"]`);
      const top = Math.max(y, floor);
      next[item.id] = top;
      floor = top + (el?.offsetHeight ?? 48) + 12;
    }
    setTops((previous) => {
      const same =
        Object.keys(next).length === Object.keys(previous).length &&
        Object.entries(next).every(([k, v]) => previous[k] === v);
      return same ? previous : next;
    });
  }, [stacked, noted, groups, plan, tick]);

  // Bring the emphasised note into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to a new focus.
  useEffect(() => {
    if (!open || !focusId) return;
    const top = tops[focusId];
    if (top === undefined) return;
    const view = top - scroll.scrollTop;
    if (view < 80 || view > scroll.clientHeight - 140)
      scroll.scrollTo({
        top: top - scroll.clientHeight * 0.3,
        behavior: reduced ? 'auto' : 'smooth',
      });
  }, [focusId, open]);

  if (!plan || !groups.length) return null;
  const gutterX = plan.proseRight + 6;
  const laneLeft = plan.proseRight - plan.shift + LANE_GAP;
  const hovered = hoveredIds[0];
  const hoveredGroup = groups.find((group) => hovered && group.ids.includes(hovered));
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.23, 1, 0.32, 1] as const };

  const markers = (
    <div className="proto-mwrap" ref={wrap}>
      {groups.map((group) => {
        const width = 24; // every marker shares one x
        const x = Math.min(gutterX, scroll.clientWidth + shifted.current - width - 4);
        return (
          <button
            key={group.para}
            type="button"
            className="proto-marker2"
            data-active={open && focusId !== null && group.ids.includes(focusId)}
            aria-label={`${group.ids.length} note${group.ids.length > 1 ? 's' : ''} on paragraph ${group.para}`}
            style={{ top: group.y - 12, left: x }}
            onMouseEnter={() => setHoveredIds(group.ids)}
            onMouseLeave={() => setHoveredIds([])}
            onFocus={() => setHoveredIds(group.ids)}
            onBlur={() => setHoveredIds([])}
            onClick={() => onMarker(group.ids)}
          >
            <ReaderIcon name="note" size={16} />
            {group.ids.length > 1 && <small>{group.ids.length}</small>}
          </button>
        );
      })}
    </div>
  );

  const noteBlock = (
    item: PassageHighlight,
    index: number,
    style: { top?: number; position?: 'relative' },
  ) => (
    <motion.div
      key={item.id}
      className="proto-lnote"
      data-note={item.id}
      data-color={item.color}
      data-focus={focusId === item.id}
      data-hover={hoveredIds.includes(item.id)}
      style={style}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4, transition: { duration: reduced ? 0 : 0.12 } }}
      transition={{ ...transition, delay: reduced ? 0 : 0.03 * index }}
      onMouseEnter={() => setHoveredIds([item.id])}
      onMouseLeave={() => setHoveredIds([])}
    >
      <button type="button" className="proto-lnote-text" onClick={() => onFocus(item.id)}>
        {item.note}
      </button>
      <div className="proto-lnote-meta">
        <span>¶{paragraphNumber(prose as HTMLElement, item.range.startContainer)}</span>
        <span className="proto-lnote-actions">
          <button
            type="button"
            aria-label="Edit note"
            title="Edit note"
            onClick={() => onEdit(item.id)}
          >
            <ProtoIcon name="pencil" size={13} />
          </button>
          <button
            type="button"
            aria-label="Delete note"
            title="Delete note"
            onClick={() => onRemove(item.id)}
          >
            <ProtoIcon name="trash" size={13} />
          </button>
        </span>
      </div>
    </motion.div>
  );

  // The hairline from the gutter to the hovered note.
  const link =
    stacked && hoveredGroup && hovered && tops[hovered] !== undefined
      ? (() => {
          const x1 = gutterX - plan.shift + 30;
          const y1 = hoveredGroup.y;
          const x2 = laneLeft - 6;
          const y2 = (tops[hovered] as number) + 12;
          const mid = (x1 + x2) / 2;
          return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
        })()
      : null;

  return (
    <>
      {createPortal(
        <>
          {markers}
          {stacked && (
            <svg className="proto-hairline" aria-hidden="true">
              <path d={link ?? ''} data-on={Boolean(link)} />
            </svg>
          )}
          <AnimatePresence>
            {stacked && (
              <div className="proto-lane2" ref={lane} style={{ left: laneLeft, width: LANE }}>
                {noted.map((item, index) => noteBlock(item, index, { top: tops[item.id] ?? 0 }))}
              </div>
            )}
          </AnimatePresence>
        </>,
        host,
      )}
      {open &&
        createPortal(
          <button
            type="button"
            className="proto-lane-close"
            aria-label="Close notes"
            title="Close notes (Esc)"
            onClick={onClose}
          >
            <ProtoIcon name="close" size={16} />
          </button>,
          panel,
        )}
      {open &&
        plan.overlay &&
        createPortal(
          <motion.aside
            className="proto-lane-overlay"
            aria-label="Notes"
            initial={reduced ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={transition}
          >
            <div className="proto-lane-overlay-body">
              {noted.map((item, index) => noteBlock(item, index, { position: 'relative' }))}
            </div>
          </motion.aside>,
          panel,
        )}
    </>
  );
}
