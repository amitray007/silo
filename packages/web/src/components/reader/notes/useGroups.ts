import { useLayoutEffect, useState } from 'react';
import { paragraphOf, paragraphSections } from '../highlights/paragraphs';
import type { ResolvedHighlight } from '../highlights/useHighlightLayer';

/** The highlights of one paragraph, with where that paragraph sits. Coordinates are the scroll area's content. */
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

export type Groups = {
  groups: NoteGroup[];
  /** The prose frame's top, to turn a `y` into the frame's own coordinates. */
  frameTop: number;
};

const NONE: Groups = { groups: [], frameTop: 0 };

/** Group the resolved highlights by paragraph and measure each group against the prose. */
function collectGroups(
  prose: HTMLElement,
  scroll: HTMLElement,
  resolved: readonly ResolvedHighlight[],
): Groups {
  const box = scroll.getBoundingClientRect();
  const sections = paragraphSections(prose);
  const toContent = (viewportY: number) => viewportY - box.top + scroll.scrollTop;
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
  const frame = prose.parentElement ?? prose;
  return {
    groups: [...byPara.values()].sort((a, b) => a.y - b.y),
    frameTop: toContent(frame.getBoundingClientRect().top),
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
  const [tick, setTick] = useState(0);
  const [measured, setMeasured] = useState<Groups>(NONE);
  useLayoutEffect(() => {
    if (!prose || !scroll || !active) return;
    const bump = () => setTick((value) => value + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(prose);
    observer.observe(scroll);
    // Content above the prose (a wrapping title, a note card) moves it without resizing it.
    const article = prose.closest('.silo-reader');
    if (article) observer.observe(article);
    document.fonts?.addEventListener('loadingdone', bump);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', bump);
    };
  }, [prose, scroll, active]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-reads the layout after it changes.
  useLayoutEffect(() => {
    setMeasured(prose && scroll && active ? collectGroups(prose, scroll, resolved) : NONE);
  }, [prose, scroll, resolved, active, tick]);
  return measured;
}
