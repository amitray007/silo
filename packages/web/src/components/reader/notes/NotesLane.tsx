import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HighlightsApi } from '../highlights/useHighlights';
import { ReaderIcon } from '../ReaderIcon';
import { hairlinePath } from './hairline';
import { entryOf, LaneBlock, lostEntry, type NoteEntry } from './LaneBlock';
import { LaneGroup } from './LaneGroup';
import { LANE, LANE_GAP } from './plan';
import { groupMax, type Slot, type StackRow, slotsOverlap, stackRows } from './stack';
import { useColumnShift } from './useColumnShift';
import type { Groups } from './useGroups';
import type { NotesLaneApi } from './useNotesLane';

const ORPHANS = 'orphans';
/** The orphan group scrolls inside itself past this height. */
const ORPHANS_MAX = 160;
/** Settle time before the dev overlap check reads the layout. */
const SETTLE_MS = 600;

/** The measured height of every block in a group. */
function blockHeights(lane: HTMLElement, key: string): number[] {
  return Array.from(lane.querySelectorAll<HTMLElement>(`[data-group="${key}"] [data-note]`)).map(
    (block) => block.offsetHeight,
  );
}

/** Scroll a block's group so the block is visible inside it. */
function revealInGroup(target: HTMLElement, behavior: ScrollBehavior): void {
  const scroller = target.closest<HTMLElement>('.silo-lgroup-scroll');
  if (!scroller) return;
  const above = target.offsetTop < scroller.scrollTop;
  const below = target.offsetTop + target.offsetHeight > scroller.scrollTop + scroller.clientHeight;
  if (above || below) scroller.scrollTo({ top: Math.max(0, target.offsetTop - 4), behavior });
}

/** Scroll the reader so a group at `top` (in the scroll area's content) is on screen. */
function revealGroup(scroll: HTMLElement, top: number, behavior: ScrollBehavior): void {
  const view = top - scroll.scrollTop;
  if (view < 80 || view > scroll.clientHeight - 140)
    scroll.scrollTo({ top: top - scroll.clientHeight * 0.3, behavior });
}

function sameSlots(a: Map<string, Slot>, b: Map<string, Slot>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, slot] of b) {
    const old = a.get(key);
    if (!old || old.top !== slot.top || old.max !== slot.max || old.height !== slot.height)
      return false;
  }
  return true;
}

/**
 * The notes lane: every highlight as a block beside its paragraph, grouped per paragraph. The
 * article column makes room on a spring; the lane lists blocks in a panel over the pane when
 * nothing fits. Loaded the first time the lane opens.
 */
export function NotesLane({
  api,
  lane,
  groups,
  prose,
  scroll,
  host,
  panel,
  gutterOffset,
  onDialHidden,
  onOverlay,
}: {
  api: HighlightsApi;
  lane: NotesLaneApi;
  groups: Groups;
  prose: HTMLElement;
  scroll: HTMLElement;
  /** The layer in the scroll area the lane and its connector draw in. */
  host: HTMLElement;
  panel: HTMLElement;
  /** From the prose's right edge to where the connector starts. */
  gutterOffset: number;
  onDialHidden: (hidden: boolean) => void;
  onOverlay: (overlay: boolean) => void;
}) {
  const { orphans, canWrite } = api;
  const reduced = useReducedMotion() ?? false;
  const { open, focusIds, hoveredIds } = lane;
  const focusId = focusIds[0] ?? null;
  const [adding, setAdding] = useState<string | null>(null);
  const [blockTick, setBlockTick] = useState(0);
  const hairline = useRef<SVGPathElement>(null);
  const paintLayout = useRef(() => {});
  const [slots, setSlots] = useState<Map<string, Slot>>(new Map());
  const [laneEl, setLaneEl] = useState<HTMLElement | null>(null);

  const anchor = () => {
    const found = api.resolved.find((entry) => entry.id === focusId);
    return found?.range.startContainer.parentElement ?? null;
  };
  const shift = useColumnShift({
    prose,
    scroll,
    open,
    anchor,
    reduced,
    onDialHidden,
  });
  const { plan, stacked, overlay } = shift;
  const frame = prose.parentElement ?? prose;
  useEffect(() => {
    onOverlay(open && (overlay || Boolean(plan?.overlay)));
    return () => onOverlay(false);
  }, [open, overlay, plan?.overlay, onOverlay]);

  const lostEntries = useMemo(() => orphans.map(lostEntry), [orphans]);
  const keyed = useMemo(
    () =>
      groups.groups.map((group) => ({
        key: `p${group.para}`,
        group,
        entries: group.items.map(entryOf),
      })),
    [groups.groups],
  );
  const blockKey = `${keyed.map((g) => g.entries.map((e) => `${e.id}${e.note ? 1 : 0}`).join()).join('|')}/${lostEntries.length}/${adding ?? ''}`;

  const measureHairline = useCallback(
    (next?: Map<string, Slot>, rangeYs?: ReadonlyMap<string, number>) => {
      const path = hairline.current;
      if (!path) return;
      const hovered = hoveredIds[0];
      const found = api.resolved.find((item) => item.id === hovered);
      const target = hovered
        ? laneEl?.querySelector<HTMLElement>(`[data-note="${CSS.escape(hovered)}"]`)
        : null;
      const link =
        stacked && found && target
          ? hairlinePath(frame, target, found.range, gutterOffset, next, rangeYs?.get(found.id))
          : '';
      return () => {
        path.setAttribute('d', link);
        path.dataset.on = String(Boolean(link));
      };
    },
    [stacked, api.resolved, hoveredIds, laneEl, frame, gutterOffset],
  );
  // Internal scrolling changes only the hovered block's connector, never the paragraph layout.
  const onScrolled = useCallback(() => measureHairline()?.(), [measureHairline]);

  const measure = useCallback(() => {
    if (!stacked || !laneEl) return;
    const current = groups.read();
    const rows: StackRow[] = [];
    if (lostEntries.length > 0)
      rows.push({
        key: ORPHANS,
        anchor: current.frameTop,
        max: ORPHANS_MAX,
        blocks: blockHeights(laneEl, ORPHANS),
      });
    for (const group of current.groups)
      rows.push({
        key: `p${group.para}`,
        anchor: group.top - 2,
        max: groupMax(group.paragraphHeight),
        blocks: blockHeights(laneEl, `p${group.para}`),
      });
    const next = stackRows(rows);
    const left = frame.clientWidth + LANE_GAP;
    const placements = Array.from(next, ([key, slot]) => {
      const group = laneEl.querySelector<HTMLElement>(`[data-group="${key}"]`);
      return { group, scroller: group?.querySelector<HTMLElement>('.silo-lgroup-scroll'), slot };
    });
    const paintHairline = measureHairline(next, current.rangeYs);
    // All subscribers finish reading before this write phase runs in the same callback.
    return () => {
      laneEl.style.left = `${left}px`;
      for (const { group, scroller, slot } of placements) {
        if (!group || !scroller) continue;
        group.style.top = `${slot.top}px`;
        group.dataset.placed = 'true';
        scroller.style.maxHeight = `${slot.max}px`;
      }
      paintHairline?.();
      setSlots((previous) => (sameSlots(previous, next) ? previous : next));
    };
  }, [stacked, laneEl, groups, lostEntries.length, frame, measureHairline]);
  paintLayout.current = () => measure()?.();
  // biome-ignore lint/correctness/useExhaustiveDependencies: blockKey and blockTick follow block content and height.
  useLayoutEffect(() => {
    measure()?.();
    return groups.subscribe(measure);
  }, [measure, groups, blockKey, blockTick]);

  // A field growing or a note being added must move later groups in this same resize callback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: observers follow the set of blocks.
  useLayoutEffect(() => {
    if (!stacked || !laneEl) return;
    const resize = new ResizeObserver(() => {
      paintLayout.current();
      setBlockTick((value) => value + 1);
    });
    for (const block of laneEl.querySelectorAll('[data-note]')) resize.observe(block);
    return () => resize.disconnect();
  }, [stacked, laneEl, blockKey]);

  // Dev assertion: no two groups may overlap once the layout has settled.
  useEffect(() => {
    if (!import.meta.env.DEV || !stacked) return;
    const timer = window.setTimeout(() => {
      const placed = [...slots.entries()];
      for (const [i, [keyA, a]] of placed.entries())
        for (const [keyB, b] of placed.slice(i + 1))
          if (slotsOverlap(a, b)) console.warn('[notes lane] groups overlap', keyA, keyB);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [stacked, slots]);

  // Bring the emphasised block into view: scroll its group, then the reader. It runs once for
  // each new emphasis, as soon as the group has a place (on the first docked open that is a pass
  // after the lane mounts).
  const revealed = useRef<readonly string[] | null>(null);
  useEffect(() => {
    if (!open || !focusId || !stacked || !laneEl) {
      revealed.current = null;
      return;
    }
    const para = groups.groups.find((g) => g.items.some((item) => item.id === focusId))?.para;
    const top = para === undefined ? undefined : slots.get(`p${para}`)?.top;
    if (top === undefined || revealed.current === focusIds) return;
    revealed.current = focusIds;
    const behavior = reduced ? 'auto' : 'smooth';
    const target = laneEl.querySelector<HTMLElement>(`[data-note="${CSS.escape(focusId)}"]`);
    if (target) revealInGroup(target, behavior);
    const frameTop =
      frame.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    revealGroup(scroll, top + frameTop, behavior);
  }, [focusId, focusIds, open, stacked, laneEl, slots, groups.groups, reduced, scroll, frame]);

  const block = (entry: NoteEntry, index: number) => (
    <LaneBlock
      key={entry.id}
      entry={entry}
      index={index}
      emphasised={focusIds.includes(entry.id)}
      hovered={hoveredIds.includes(entry.id)}
      adding={adding === entry.id}
      canWrite={canWrite}
      onFocus={(id) => lane.focus([id])}
      onHover={lane.setHoveredIds}
      onAdd={setAdding}
      onSetNote={api.setNote}
      onEdit={lane.edit}
      onDelete={api.remove}
    />
  );

  if (!plan) return null;
  const everything: NoteEntry[] = [...lostEntries, ...keyed.flatMap((g) => g.entries)];
  return (
    <>
      {createPortal(
        <>
          {stacked && (
            <svg className="silo-hairline" aria-hidden="true">
              <path ref={hairline} />
            </svg>
          )}
          {stacked && (
            <section
              className="silo-lane"
              aria-label="Notes"
              data-notes-lane
              ref={setLaneEl}
              style={{ width: LANE }}
            >
              {lostEntries.length > 0 && (
                <LaneGroup
                  groupKey={ORPHANS}
                  slot={slots.get(ORPHANS)}
                  version={blockTick}
                  smooth={!reduced}
                  onScrolled={onScrolled}
                >
                  {lostEntries.map(block)}
                </LaneGroup>
              )}
              {keyed.map(({ key, entries }) => (
                <LaneGroup
                  key={key}
                  groupKey={key}
                  slot={slots.get(key)}
                  version={blockTick}
                  smooth={!reduced}
                  onScrolled={onScrolled}
                >
                  {entries.map(block)}
                </LaneGroup>
              ))}
            </section>
          )}
        </>,
        host,
      )}
      {open &&
        createPortal(
          <button
            type="button"
            className="silo-lane-close"
            data-notes-open
            aria-label="Close notes"
            title="Close notes (Esc)"
            onClick={lane.close}
          >
            <ReaderIcon name="close" size={16} />
          </button>,
          panel,
        )}
      {overlay &&
        createPortal(
          <aside className="silo-lane-overlay" aria-label="Notes" data-notes-lane>
            <div className="silo-lane-overlay-body">{everything.map(block)}</div>
          </aside>,
          panel,
        )}
    </>
  );
}
