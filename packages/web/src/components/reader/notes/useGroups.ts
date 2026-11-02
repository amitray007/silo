import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { articleParagraphIndex } from '../highlights/paragraphs';
import type { ResolvedHighlight } from '../highlights/useHighlightLayer';
import { DECORATION, proseMutation } from '../place/proseVersion';

/** The highlights of one paragraph, with where that paragraph sits. Coordinates are relative to the prose frame. */
export type NoteGroup = {
  /** The 1-based paragraph number. */
  para: number;
  /** In reading order. */
  items: ResolvedHighlight[];
  /** The centre of the first highlighted line. */
  y: number;
  /** The first line's line height, for moving a marker down one line. */
  lineHeight: number;
  /** The paragraph's top and height. */
  top: number;
  paragraphHeight: number;
};

type GroupLayout = {
  groups: NoteGroup[];
  /** Each highlighted range's first-line centre, in frame coordinates. */
  rangeYs: ReadonlyMap<string, number>;
  /** The prose frame's top, to turn a `y` into the frame's own coordinates. */
  frameTop: number;
};

export type Groups = GroupLayout & {
  /** Read the shared snapshot, invalidated by each layout change. */
  read: () => GroupLayout;
  /** Read now and return a paint callback. Every subscriber reads before any subscriber paints. */
  subscribe: (measure: () => (() => void) | undefined) => () => void;
};

const withoutTransform = (style: string | null) =>
  (style ?? '')
    .replace(/(?:^|;)\s*transform\s*:[^;]*/g, '')
    .replace(/;\s*$/, '')
    .trim();

const NONE: GroupLayout = { groups: [], rangeYs: new Map(), frameTop: 0 };

/** Group the resolved highlights by paragraph and measure each group against the prose. */
function collectGroups(
  prose: HTMLElement,
  frame: HTMLElement,
  resolved: readonly ResolvedHighlight[],
): GroupLayout {
  const box = frame.getBoundingClientRect();
  const { sections, paragraph } = articleParagraphIndex(prose);
  const toContent = (viewportY: number) => viewportY - box.top - frame.clientTop + frame.scrollTop;
  const byPara = new Map<number, NoteGroup>();
  const rangeYs = new Map<string, number>();
  for (const item of resolved) {
    const para = paragraph(item.range.startContainer);
    const rect = item.range.getClientRects()[0] ?? item.range.getBoundingClientRect();
    const y = toContent(rect.top + rect.height / 2);
    rangeYs.set(item.id, y);
    const existing = byPara.get(para);
    if (existing) {
      existing.items.push(item);
      existing.y = Math.min(existing.y, y);
      continue;
    }
    const section = sections[para - 1]?.getBoundingClientRect();
    const host = item.range.startContainer.parentElement ?? prose;
    byPara.set(para, {
      para,
      items: [item],
      y,
      lineHeight: Number.parseFloat(getComputedStyle(host).lineHeight) || 28,
      top: section ? toContent(section.top) : toContent(rect.top),
      paragraphHeight: section?.height ?? 0,
    });
  }
  return {
    groups: [...byPara.values()].sort((a, b) => a.y - b.y),
    rangeYs,
    frameTop: 0,
  };
}

/**
 * The paragraph groups, re-measured when the highlights change, when the prose or the pane
 * resizes, and when web fonts finish loading. With nothing to place (`active` false) it does no
 * measuring at all.
 */
export function useGroups(
  prose: HTMLElement | null,
  scroll: HTMLElement | null,
  resolved: readonly ResolvedHighlight[],
  active: boolean,
): Groups {
  const frame = prose?.parentElement ?? prose;
  const listeners = useMemo(() => new Set<() => (() => void) | undefined>(), []);
  const [measured, setMeasured] = useState<GroupLayout>(NONE);
  const layout = useMemo(() => {
    let snapshot: GroupLayout | undefined;
    return {
      read: () => {
        snapshot ??= prose && frame && active ? collectGroups(prose, frame, resolved) : NONE;
        return snapshot;
      },
      invalidate: () => {
        snapshot = undefined;
      },
    };
  }, [prose, frame, resolved, active]);
  const { read } = layout;
  const subscribe = useCallback(
    (measure: () => (() => void) | undefined) => {
      listeners.add(measure);
      return () => {
        listeners.delete(measure);
      };
    },
    [listeners],
  );
  useLayoutEffect(() => {
    // React owns the set of groups. Geometry subscribers own their positions.
    setMeasured(read());
    if (!prose || !frame || !scroll || !active) return;
    let pending = false;
    let disposed = false;
    let dirty = false;
    let membershipChanged = false;
    const paint = (invalidate = true) => {
      pending = false;
      if (invalidate || dirty) layout.invalidate();
      dirty = false;
      const paints = Array.from(listeners, (measure) => measure());
      for (const paint of paints) paint?.();
      if (membershipChanged) {
        membershipChanged = false;
        setMeasured(read());
      }
    };
    const schedule = () => {
      dirty = true;
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        if (!pending || disposed) return;
        // Consume mutations made since this delivery before the shared read/write pass.
        onMutations(changes.takeRecords());
        if (pending) paint();
      });
    };
    // Resize delivery can consume a pending mutation pass. Microtasks also finish in this
    // frame when a resize callback changes padding after the browser's resize-delivery depth.
    const observer = new ResizeObserver(() => paint());
    const article = prose.closest('.silo-reader') ?? frame;
    for (const element of new Set([prose, frame, scroll, article, ...prose.children]))
      observer.observe(element);
    const onMutations = (records: MutationRecord[]) => {
      const relevant = records.filter(
        (record) =>
          !(record.target instanceof Element && record.target.closest(DECORATION)) &&
          proseMutation(record),
      );
      if (!relevant.length) return;
      const reflow = relevant.some(
        (record) =>
          record.target !== article ||
          record.attributeName !== 'style' ||
          withoutTransform(record.oldValue) !== withoutTransform(article.getAttribute('style')),
      );
      if (!reflow) {
        // The frame and its marks move together; only gutter clamping/connectors need paint.
        paint(false);
        return;
      }
      if (
        relevant.some((record) => record.type !== 'attributes' && prose.contains(record.target))
      ) {
        for (const child of prose.children) observer.observe(child);
        // Membership changes also change the React-owned set of paragraph groups.
        membershipChanged = true;
      }
      schedule();
    };
    const changes = new MutationObserver(onMutations);
    changes.observe(article, {
      attributes: true,
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['style', 'class', 'data-width'],
      attributeOldValue: true,
    });
    const reflow = schedule;
    window.addEventListener('resize', reflow);
    document.fonts?.addEventListener('loadingdone', reflow);
    return () => {
      disposed = true;
      pending = false;
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', reflow);
      document.fonts?.removeEventListener('loadingdone', reflow);
    };
  }, [prose, frame, scroll, active, read, layout, listeners]);
  return useMemo(() => ({ ...measured, read, subscribe }), [measured, read, subscribe]);
}
