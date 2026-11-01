// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReaderIcon } from '../ReaderIcon';
import { ProtoIcon } from './ProtoIcon';
import { paragraphNumber, paragraphSections } from './paragraphs.prototype';
import { SavedPlace } from './SavedPlace';
import type { PassageHighlight } from './useHighlights';
import type { PencilApi } from './usePencil';
import type { ReadAloudApi } from './useReadAloud';
import type { SavedPlaceApi } from './useSavedPlace';

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
  needsCollapse?: boolean;
  proseRight: number; // natural prose right edge, minus `extra`
};

type Group = {
  para: number;
  ids: string[];
  items: PassageHighlight[];
  y: number; // centre of the first noted line
  colors: string[];
  lineHeight: number;
};

type Geometry = { left: number; width: number; proseRight0: number; room: number };

/** The column's natural (untransformed) geometry, or what it would be in a pane `delta` wider. */
function geometry(
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
      proseRight0: article.offsetLeft + (p.right - a.left) + applied,
      room: scroll.clientWidth,
    };
  }
  // A wider pane re-centres the article, up to its max width.
  const room = scroll.clientWidth + delta;
  const max = Number.parseFloat(getComputedStyle(article).maxWidth) || article.offsetWidth;
  const rightInset = a.right - p.right - applied;
  const articleWidth = Math.min(max, room);
  const left = (room - articleWidth) / 2 + inset;
  const proseWidth = articleWidth - inset - rightInset;
  return { left, width: proseWidth, proseRight0: left + proseWidth, room };
}

const sidebarCollapsed = () =>
  document.querySelector<HTMLElement>('.silo-frame')?.dataset.collapsed === 'true';

/** The app's own sidebar toggle is the "[" key; the prototype's variant switcher lets this one through. */
function toggleSidebar() {
  const event = new KeyboardEvent('keydown', { key: '[', bubbles: true, cancelable: true });
  Object.defineProperty(event, '__protoPass', { value: true });
  document.dispatchEvent(event);
}

/** Work out how the column makes room for the lane. */
function planColumn(g: Geometry, open: boolean, has: boolean, gutter = false): Plan {
  const { left, width, proseRight0 } = g;
  const free = g.room - proseRight0;
  const reserve = has || gutter ? Math.max(0, MARKER_GUTTER - free) : 0;
  if (!(open && has))
    return {
      extra: reserve,
      shift: 0,
      hideDial: false,
      overlay: false,
      proseRight: proseRight0 - reserve,
    };
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
  alsoFocus = [],
  hoveredIds,
  setHoveredIds,
  onMarker,
  onFocus,
  onClose,
  onEdit,
  onRemove,
  onSetNote,
  onDialHidden,
  resume: pencilResume,
  onResume,
  place,
  ra,
  pencil,
}: {
  items: PassageHighlight[];
  prose: HTMLElement | null;
  scroll: HTMLElement;
  host: HTMLElement;
  panel: HTMLElement;
  open: boolean;
  focusId: string | null;
  alsoFocus?: string[];
  hoveredIds: string[];
  setHoveredIds: (ids: string[]) => void;
  onMarker: (ids: string[]) => void;
  onFocus: (id: string) => void;
  onClose: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onSetNote: (id: string, note: string) => void;
  onDialHidden: (hidden: boolean) => void;
  /** The pencil's resume line, drawn in the same gutter column as the note markers. */
  resume: { y: number } | null;
  onResume: () => void;
  place?: SavedPlaceApi | undefined;
  ra?: ReadAloudApi;
  pencil?: PencilApi;
}) {
  const resume = place ? (place.style === 'sentence' ? place.anchor : null) : pencilResume;
  const reduced = useReducedMotion() ?? false;
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  // Lane groups: one per paragraph, anchored at the paragraph's top, scrolling inside themselves.
  type Slot = { top: number; max: number };
  type Edges = { up: boolean; down: boolean; hidden: number };
  const [slots, setSlots] = useState<Record<number, Slot>>({});
  const [edges, setEdges] = useState<Record<number, Edges>>({});
  const lane = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const applied = useRef(0);
  const base = useRef<number | null>(null);
  const shifted = useRef(0);
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  // The lane lists every highlight: noted ones show their note, bare ones show their snippet.
  const noted = items;
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
    const now = planColumn(
      geometry(article, prose, scroll, applied.current, 0),
      open,
      has,
      Boolean(place || resume),
    );
    if (!(open && has && now.overlay) || sidebarCollapsed()) return now;
    // The lane does not fit beside the list. Would it fit if the sidebar collapsed?
    const delta = document.querySelector('.silo-sidebar')?.getBoundingClientRect().width ?? 0;
    if (!delta) return now;
    const wider = planColumn(
      geometry(article, prose, scroll, applied.current, delta),
      open,
      has,
      Boolean(place || resume),
    );
    return wider.overlay ? now : { ...now, needsCollapse: true };
  }, [article, prose, scroll, open, has, tick, Boolean(place || resume)]);

  // Collapse the sidebar through the app's own toggle while the lane needs the room, and put it
  // back afterwards, but only if the lane was what collapsed it.
  const collapsedByLane = useRef(false);
  const [collapsing, setCollapsing] = useState(false);
  const needsCollapse = Boolean(plan?.needsCollapse);
  useEffect(() => {
    if (open && needsCollapse && !collapsedByLane.current) {
      collapsedByLane.current = true;
      setCollapsing(true);
      toggleSidebar();
      window.setTimeout(() => {
        setCollapsing(false);
        setTick((value) => value + 1);
      }, 380);
      return;
    }
    if (!open && collapsedByLane.current) {
      collapsedByLane.current = false;
      setCollapsing(false);
      toggleSidebar();
    }
  }, [open, needsCollapse]);
  useEffect(
    () => () => {
      if (collapsedByLane.current) {
        collapsedByLane.current = false;
        toggleSidebar();
      }
    },
    [],
  );

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
      const lineHeight =
        Number.parseFloat(
          getComputedStyle(item.range.startContainer.parentElement ?? prose).lineHeight,
        ) || 28;
      const group = byPara.get(para) ?? { para, ids: [], items: [], y, colors: [], lineHeight };
      group.ids.push(item.id);
      group.items.push(item);
      group.y = Math.min(group.y, y);
      if (!group.colors.includes(item.color)) group.colors.push(item.color);
      byPara.set(para, group);
    }
    return [...byPara.values()].sort((a, b) => a.y - b.y);
  }, [noted, prose, scroll, tick, plan]);

  // Lane layout: each note at its passage's top, pushed down to avoid overlap.
  const stacked = open && plan && !plan.overlay && !plan.needsCollapse && !collapsing;
  // Re-run the layout whenever a block's real height changes (a field growing, a bare block turning
  // into a noted one), when the lane has finished opening, and when fonts finish loading.
  const [blockTick, setBlockTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: observers follow the set of blocks.
  useEffect(() => {
    const host = lane.current;
    if (!stacked || !host) return;
    const bump = () => setBlockTick((value) => value + 1);
    const resize = new ResizeObserver(bump);
    const watch = () => {
      for (const el of host.querySelectorAll('.proto-lnote')) resize.observe(el);
    };
    watch();
    const mutation = new MutationObserver(watch);
    mutation.observe(host, { childList: true });
    const settled = window.setTimeout(bump, 450);
    void document.fonts?.ready.then(bump);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.clearTimeout(settled);
    };
  }, [stacked, items.length]);

  // Each paragraph's group goes at the paragraph's top, no taller than the paragraph (at least
  // 112px), and below the group before it. Heights are measured, never estimated.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-stack when anything that moves a group changes.
  useLayoutEffect(() => {
    const host = lane.current;
    if (!stacked || !host || !prose) return;
    const box = scroll.getBoundingClientRect();
    const sections = paragraphSections(prose);
    const rows = groups.map((group) => {
      const section = sections[group.para - 1];
      const rect = section?.getBoundingClientRect();
      const first = group.items[0];
      const fallback = first ? first.range.getBoundingClientRect() : null;
      const top = (rect ?? fallback)?.top ?? 0;
      return {
        para: group.para,
        y: top - box.top + scroll.scrollTop - 2,
        max: Math.max(rect?.height ?? 0, 112),
      };
    });
    rows.sort((a, b) => a.y - b.y);
    const next: Record<number, Slot> = {};
    let floor = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const el = host.querySelector<HTMLElement>(`[data-group="${row.para}"]`);
      const top = Math.max(row.y, floor);
      next[row.para] = { top, max: row.max };
      floor = top + (el?.offsetHeight ?? 0) + 12;
    }
    setSlots((previous) => {
      const same =
        Object.keys(next).length === Object.keys(previous).length &&
        Object.entries(next).every(([k, v]) => {
          const old = previous[Number(k)];
          return old && old.top === v.top && old.max === v.max;
        });
      return same ? previous : next;
    });
  }, [stacked, groups, plan, tick, blockTick, adding, focusId]);

  // Which groups can still scroll up or down, and how many blocks are hidden below.
  const measureEdges = (scroller: HTMLElement): Edges => {
    let hidden = 0;
    for (const child of Array.from(scroller.children) as HTMLElement[])
      if (child.offsetTop + child.offsetHeight > scroller.scrollTop + scroller.clientHeight + 1)
        hidden += 1;
    return {
      up: scroller.scrollTop > 1,
      down: scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1,
      hidden,
    };
  };
  const refreshEdges = (scroller: HTMLElement) => {
    const para = Number(scroller.dataset.scroller);
    const next = measureEdges(scroller);
    setEdges((previous) => {
      const old = previous[para];
      return old && old.up === next.up && old.down === next.down && old.hidden === next.hidden
        ? previous
        : { ...previous, [para]: next };
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure after every layout change.
  useLayoutEffect(() => {
    const host = lane.current;
    if (!stacked || !host) return;
    for (const el of host.querySelectorAll<HTMLElement>('.proto-lgroup-scroll')) refreshEdges(el);
  }, [stacked, slots, blockTick, noted, adding]);

  // Dev assertion: no two lane groups may intersect once the layout has settled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: slots is the trigger, not a value used inside.
  useEffect(() => {
    const host = lane.current;
    if (!stacked || !host) return;
    const frame = window.setTimeout(() => {
      const rects = Array.from(host.querySelectorAll<HTMLElement>('.proto-lgroup')).map((el) => ({
        id: el.dataset.group,
        rect: el.getBoundingClientRect(),
      }));
      for (let i = 0; i < rects.length; i += 1)
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = (rects[i] as (typeof rects)[number]).rect;
          const b = (rects[j] as (typeof rects)[number]).rect;
          if (a.top < b.bottom - 1 && b.top < a.bottom - 1)
            console.warn('[notes lane] groups overlap', rects[i]?.id, rects[j]?.id);
        }
    }, 600);
    return () => window.clearTimeout(frame);
  }, [stacked, slots]);

  // Bring the emphasised note into view: scroll its group, then the reader.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to a new focus.
  useEffect(() => {
    if (!open || !focusId) return;
    const host = lane.current;
    const block = host?.querySelector<HTMLElement>(`[data-note="${focusId}"]`);
    const scroller = block?.closest<HTMLElement>('.proto-lgroup-scroll');
    if (block && scroller) {
      const above = block.offsetTop < scroller.scrollTop;
      const below =
        block.offsetTop + block.offsetHeight > scroller.scrollTop + scroller.clientHeight;
      if (above || below)
        scroller.scrollTo({
          top: Math.max(0, block.offsetTop - 4),
          behavior: reduced ? 'auto' : 'smooth',
        });
    }
    const para = groups.find((group) => group.ids.includes(focusId))?.para;
    const top = para === undefined ? undefined : slots[para]?.top;
    if (top === undefined) return;
    const view = top - scroll.scrollTop;
    if (view < 80 || view > scroll.clientHeight - 140)
      scroll.scrollTo({
        top: top - scroll.clientHeight * 0.3,
        behavior: reduced ? 'auto' : 'smooth',
      });
  }, [focusId, open]);

  if (!plan || (!groups.length && !resume && !place)) return null;
  const gutterX = plan.proseRight + 6;
  const laneLeft = plan.proseRight - plan.shift + LANE_GAP;
  const hovered = hoveredIds[0];
  const hoveredGroup = groups.find((group) => hovered && group.ids.includes(hovered));
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.23, 1, 0.32, 1] as const };

  // A note marker that would touch the resume button moves down to a later line of its paragraph.
  const markerY = (group: Group) => {
    if (!resume || Math.abs(group.y - resume.y) >= 28) return group.y;
    return group.y + Math.ceil(28 / group.lineHeight) * group.lineHeight;
  };
  const gutterLeft = Math.min(gutterX, scroll.clientWidth + shifted.current - 24 - 4);

  const markers = (
    <div
      className="proto-mwrap"
      ref={(el) => {
        wrap.current = el;
        // The layer can mount after the shift began; start it where the column already is.
        if (el && shifted.current && !el.style.transform)
          el.style.transform = `translateX(${-shifted.current}px)`;
      }}
      style={open && plan.overlay ? { visibility: 'hidden' } : {}}
    >
      {place && ra && pencil && (
        <SavedPlace
          place={place}
          prose={prose}
          scroll={scroll}
          host={host}
          panel={panel}
          ra={ra}
          pencil={pencil}
          gutterLeft={gutterLeft}
        />
      )}
      {!place && resume && (
        <button
          type="button"
          className="proto-resume"
          title="Resume reading (P)"
          aria-label="Resume reading"
          style={{ top: resume.y - 12, left: gutterLeft }}
          onClick={onResume}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 4.5v15l12-7.5z" />
          </svg>
        </button>
      )}
      {groups.map((group) => {
        const width = 24; // every marker shares one x
        const x = Math.min(gutterX, scroll.clientWidth + shifted.current - width - 4);
        return (
          <button
            key={group.para}
            type="button"
            className="proto-marker2"
            data-active={open && focusId !== null && group.ids.includes(focusId)}
            aria-label={`${group.ids.length} highlight${group.ids.length > 1 ? 's' : ''} on paragraph ${group.para}`}
            style={{ top: markerY(group) - 12, left: x }}
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
      data-focus={focusId === item.id || alsoFocus.includes(item.id)}
      data-hover={hoveredIds.includes(item.id)}
      style={style}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4, transition: { duration: reduced ? 0 : 0.12 } }}
      transition={{ ...transition, delay: reduced ? 0 : 0.03 * index }}
      onMouseEnter={() => setHoveredIds([item.id])}
      onMouseLeave={() => setHoveredIds([])}
    >
      {adding === item.id ? (
        <textarea
          className="proto-lnote-field"
          aria-label="Add a note"
          placeholder="Add a note"
          rows={1}
          ref={(el) => {
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
            if (document.activeElement !== el) el.focus({ preventScroll: true });
          }}
          onInput={(event) => {
            event.currentTarget.style.height = 'auto';
            event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
          }}
          onBlur={(event) => {
            const text = event.currentTarget.value.trim();
            if (text) onSetNote(item.id, text);
            setAdding(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.value = '';
              event.currentTarget.blur();
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : item.note ? (
        <button type="button" className="proto-lnote-text" onClick={() => onFocus(item.id)}>
          {item.note}
        </button>
      ) : (
        <>
          <button type="button" className="proto-lnote-snippet" onClick={() => onFocus(item.id)}>
            {item.text}
          </button>
          <button type="button" className="proto-lnote-add" onClick={() => setAdding(item.id)}>
            Add note
          </button>
        </>
      )}
      <span className="proto-lnote-actions">
        {item.note && (
          <button
            type="button"
            aria-label="Edit note"
            title="Edit note"
            onClick={() => onEdit(item.id)}
          >
            <ProtoIcon name="pencil" size={13} />
          </button>
        )}
        <button
          type="button"
          aria-label="Delete highlight"
          title="Delete highlight"
          onClick={() => onRemove(item.id)}
        >
          <ProtoIcon name="trash" size={13} />
        </button>
      </span>
    </motion.div>
  );

  // The hairline from the gutter to the hovered block (hidden when it is scrolled out of its group).
  const link = (() => {
    if (!stacked || !hoveredGroup || !hovered) return null;
    const block = lane.current?.querySelector<HTMLElement>(`[data-note="${hovered}"]`);
    const scroller = block?.closest<HTMLElement>('.proto-lgroup-scroll');
    if (!block || !scroller) return null;
    const rect = block.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (rect.bottom < view.top + 4 || rect.top > view.bottom - 4) return null;
    const y2 = rect.top - scroll.getBoundingClientRect().top + scroll.scrollTop + 12;
    const x1 = gutterX - plan.shift + 30;
    const y1 = hoveredGroup.y;
    const x2 = laneLeft - 6;
    const mid = (x1 + x2) / 2;
    return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
  })();

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
                {groups.map((group) => {
                  const edge = edges[group.para];
                  return (
                    <div
                      key={group.para}
                      className="proto-lgroup"
                      data-group={group.para}
                      style={{ top: slots[group.para]?.top ?? 0 }}
                    >
                      <div
                        className="proto-lgroup-scroll"
                        data-scroller={group.para}
                        data-up={edge?.up ?? false}
                        data-down={edge?.down ?? false}
                        style={{ maxHeight: slots[group.para]?.max ?? 'none' }}
                        onScroll={(event) => refreshEdges(event.currentTarget)}
                      >
                        {group.items.map((item, index) =>
                          noteBlock(item, index, { position: 'relative' }),
                        )}
                      </div>
                      {(edge?.hidden ?? 0) > 0 && (
                        <button
                          type="button"
                          className="proto-lgroup-more"
                          aria-label={`${edge?.hidden} more highlights, scroll down`}
                          onClick={(event) => {
                            const scroller = event.currentTarget.previousElementSibling;
                            if (scroller instanceof HTMLElement)
                              scroller.scrollBy({
                                top: scroller.clientHeight * 0.9,
                                behavior: reduced ? 'auto' : 'smooth',
                              });
                          }}
                        >
                          +{edge?.hidden}
                        </button>
                      )}
                    </div>
                  );
                })}
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
        !plan.needsCollapse &&
        !collapsing &&
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
