import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { paragraphOf, paragraphSections } from '../highlights/paragraphs';
import type { ResolvedHighlight } from '../highlights/useHighlightLayer';

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
  /** The prose frame's top, to turn a `y` into the frame's own coordinates. */
  frameTop: number;
};

export type Groups = GroupLayout & {
  /** Read the current layout without waiting for a React render. */
  read: () => GroupLayout;
  /** Subscribers paint synchronously when layout changes, before the browser paints. */
  subscribe: (paint: () => void) => () => void;
};

const NONE: GroupLayout = { groups: [], frameTop: 0 };

/** Group the resolved highlights by paragraph and measure each group against the prose. */
function collectGroups(
  prose: HTMLElement,
  frame: HTMLElement,
  resolved: readonly ResolvedHighlight[],
): GroupLayout {
  const box = frame.getBoundingClientRect();
  const sections = paragraphSections(prose);
  const toContent = (viewportY: number) => viewportY - box.top - frame.clientTop + frame.scrollTop;
  const byPara = new Map<number, NoteGroup>();
  for (const item of resolved) {
    const para = paragraphOf(sections, item.range.startContainer);
    const rect = item.range.getClientRects()[0] ?? item.range.getBoundingClientRect();
    const y = toContent(rect.top + rect.height / 2);
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
  const listeners = useMemo(() => new Set<() => void>(), []);
  const [measured, setMeasured] = useState<GroupLayout>(NONE);
  const read = useCallback(
    () => (prose && frame && active ? collectGroups(prose, frame, resolved) : NONE),
    [prose, frame, resolved, active],
  );
  const subscribe = useCallback(
    (paint: () => void) => {
      listeners.add(paint);
      return () => {
        listeners.delete(paint);
      };
    },
    [listeners],
  );
  useLayoutEffect(() => {
    // React owns the set of groups. Geometry subscribers own their positions.
    setMeasured(read());
    if (!prose || !frame || !scroll || !active) return;
    const paint = () => {
      for (const listener of listeners) listener();
    };
    const observer = new ResizeObserver(paint);
    const article = prose.closest('.silo-reader') ?? frame;
    for (const element of new Set([prose, frame, scroll, article, ...prose.children]))
      observer.observe(element);
    const changes = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            !(record.target instanceof Element) ||
            !record.target.closest(
              '.silo-marker, .silo-notes-layer, .silo-place-ribbon-gutter, .silo-place-ribbon-preview, .silo-pencil',
            ),
        )
      )
        paint();
    });
    changes.observe(article, {
      attributes: true,
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['style', 'class', 'data-width'],
    });
    window.addEventListener('resize', paint);
    document.fonts?.addEventListener('loadingdone', paint);
    return () => {
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', paint);
      document.fonts?.removeEventListener('loadingdone', paint);
    };
  }, [prose, frame, scroll, active, read, listeners]);
  return useMemo(() => ({ ...measured, read, subscribe }), [measured, read, subscribe]);
}
