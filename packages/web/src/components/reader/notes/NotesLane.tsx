import { useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HighlightsApi } from '../highlights/useHighlights';
import { ReaderIcon } from '../ReaderIcon';
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

  // Re-stack whenever a block's real height changes: a field growing, a bare block gaining a note.
  // biome-ignore lint/correctness/useExhaustiveDependencies: observers follow the set of blocks.
  useEffect(() => {
    if (!stacked || !laneEl) return;
    const bump = () => setBlockTick((value) => value + 1);
    const resize = new ResizeObserver(bump);
    for (const block of laneEl.querySelectorAll('[data-note]')) resize.observe(block);
    void document.fonts?.ready.then(bump);
    return () => resize.disconnect();
  }, [stacked, laneEl, blockKey]);

  // Each paragraph's group goes at the paragraph's top, no taller than the paragraph (at least
  // 112px), and below the group before it. Heights are measured, never estimated.
  // biome-ignore lint/correctness/useExhaustiveDependencies: blockTick and blockKey are the triggers.
  useLayoutEffect(() => {
    if (!stacked || !laneEl) return;
    const rows: StackRow[] = [];
    if (lostEntries.length > 0)
      rows.push({
        key: ORPHANS,
        anchor: groups.frameTop,
        max: ORPHANS_MAX,
        blocks: blockHeights(laneEl, ORPHANS),
      });
    for (const { key, group } of keyed)
      rows.push({
        key,
        anchor: group.top - 2,
        max: groupMax(group.paragraphHeight),
        blocks: blockHeights(laneEl, key),
      });
    const next = stackRows(rows);
    setSlots((previous) => (sameSlots(previous, next) ? previous : next));
  }, [stacked, laneEl, keyed, lostEntries, groups.frameTop, blockTick, blockKey]);

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

  // Bring the emphasised block into view: scroll its group, then the reader.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to a new focus.
  useEffect(() => {
    if (!open || !focusId || !stacked) return;
    const behavior = reduced ? 'auto' : 'smooth';
    const target = laneEl?.querySelector<HTMLElement>(`[data-note="${CSS.escape(focusId)}"]`);
    if (target) revealInGroup(target, behavior);
    const para = groups.groups.find((g) => g.items.some((item) => item.id === focusId))?.para;
    const top = para === undefined ? undefined : slots.get(`p${para}`)?.top;
    if (top !== undefined) revealGroup(scroll, top, behavior);
  }, [focusId, open, stacked]);

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

  // The hairline from the gutter to the hovered block (hidden when it is scrolled out of its group).
  const hovered = hoveredIds[0];
  const link = (() => {
    if (!stacked || !plan || !hovered || !laneEl) return null;
    const hoveredGroup = groups.groups.find((g) => g.items.some((item) => item.id === hovered));
    const target = laneEl.querySelector<HTMLElement>(`[data-note="${CSS.escape(hovered)}"]`);
    const scroller = target?.closest<HTMLElement>('.silo-lgroup-scroll');
    if (!hoveredGroup || !target || !scroller) return null;
    const rect = target.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (rect.bottom < view.top + 4 || rect.top > view.bottom - 4) return null;
    const y2 = rect.top - scroll.getBoundingClientRect().top + scroll.scrollTop + 12;
    const x1 = plan.proseRight - plan.shift + gutterOffset;
    const x2 = plan.proseRight - plan.shift + LANE_GAP - 6;
    const mid = (x1 + x2) / 2;
    return `M${x1} ${hoveredGroup.y}C${mid} ${hoveredGroup.y} ${mid} ${y2} ${x2} ${y2}`;
  })();

  if (!plan) return null;
  const laneLeft = plan.proseRight - plan.shift + LANE_GAP;
  const everything: NoteEntry[] = [...lostEntries, ...keyed.flatMap((g) => g.entries)];
  return (
    <>
      {createPortal(
        <>
          {stacked && (
            <svg className="silo-hairline" aria-hidden="true">
              <path d={link ?? ''} data-on={Boolean(link)} />
            </svg>
          )}
          {stacked && (
            <section
              className="silo-lane"
              aria-label="Notes"
              data-notes-lane
              ref={setLaneEl}
              style={{ left: laneLeft, width: LANE }}
            >
              {lostEntries.length > 0 && (
                <LaneGroup
                  groupKey={ORPHANS}
                  slot={slots.get(ORPHANS)}
                  version={blockTick}
                  smooth={!reduced}
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
