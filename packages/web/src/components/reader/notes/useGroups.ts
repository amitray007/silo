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
  const sections = paragraphSections(prose);
  const toContent = (viewportY: number) => viewportY - box.top - frame.clientTop + frame.scrollTop;
  const numbers = new Map(sections.map((section, index) => [section, index + 1]));
  const paragraph = (node: Node) => {
    let element = node instanceof Element ? node : node.parentElement;
    while (element && element !== prose) {
      const number = numbers.get(element);
      if (number !== undefined) return number;
      element = element.parentElement;
    }
    return paragraphOf(sections, node);
  };
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
    const paint = (invalidate = true) => {
      if (invalidate) layout.invalidate();
      const paints = Array.from(listeners, (measure) => measure());
      for (const paint of paints) paint?.();
    };
    const observer = new ResizeObserver(() => paint());
    const article = prose.closest('.silo-reader') ?? frame;
    for (const element of new Set([prose, frame, scroll, article, ...prose.children]))
      observer.observe(element);
    const changes = new MutationObserver((records) => {
      const relevant = records.filter(
        (record) =>
          !(record.target instanceof Element) ||
          !record.target.closest(
            '.silo-marker, .silo-notes-layer, .silo-place-ribbon-gutter, .silo-place-ribbon-preview, .silo-pencil',
          ),
      );
      if (relevant.length) {
        // The frame carries its children through a transform. Their relative coordinates stay
        // valid; subscribers still repaint gutter clamping and connectors in this same frame.
        const reflow = relevant.some(
          (record) =>
            record.target !== article ||
            record.attributeName !== 'style' ||
            withoutTransform(record.oldValue) !== withoutTransform(article.getAttribute('style')),
        );
        paint(reflow);
      }
    });
    changes.observe(article, {
      attributes: true,
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['style', 'class', 'data-width'],
      attributeOldValue: true,
    });
    const reflow = () => paint();
    window.addEventListener('resize', reflow);
    document.fonts?.addEventListener('loadingdone', reflow);
    return () => {
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', reflow);
      document.fonts?.removeEventListener('loadingdone', reflow);
    };
  }, [prose, frame, scroll, active, read, layout, listeners]);
  return useMemo(() => ({ ...measured, read, subscribe }), [measured, read, subscribe]);
}
