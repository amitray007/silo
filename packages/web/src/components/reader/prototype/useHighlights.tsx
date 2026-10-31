import { useCallback, useEffect, useRef, useState } from 'react';
import { scrollToRange } from './useProseRoot';

export const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof COLORS)[number];

export type PassageHighlight = {
  id: string;
  color: HighlightColor;
  note: string;
  text: string;
  range: Range;
};

type Pending = { rect: DOMRect; range: Range } | null;

let counter = 0;

const supported =
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

export function useHighlights(root: HTMLElement | null, scroll: HTMLElement | null) {
  const [items, setItems] = useState<PassageHighlight[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [autoColor, setAutoColor] = useState<HighlightColor | null>(null);
  const autoRef = useRef(autoColor);
  autoRef.current = autoColor;

  const add = useCallback((range: Range, color: HighlightColor, note = '') => {
    const item: PassageHighlight = {
      id: `h${++counter}`,
      color,
      note,
      text: range.toString().replace(/\s+/g, ' ').trim(),
      range: range.cloneRange(),
    };
    setItems((current) =>
      [...current, item].sort((a, b) =>
        a.range.compareBoundaryPoints(Range.START_TO_START, b.range),
      ),
    );
    window.getSelection()?.removeAllRanges();
    setPending(null);
    return item;
  }, []);

  // Paint every colour with the CSS Custom Highlight API.
  useEffect(() => {
    if (!supported) return;
    for (const color of COLORS) {
      const ranges = items.filter((item) => item.color === color).map((item) => item.range);
      if (ranges.length) CSS.highlights.set(`proto-hl-${color}`, new Highlight(...ranges));
      else CSS.highlights.delete(`proto-hl-${color}`);
    }
  }, [items]);
  useEffect(
    () => () => {
      if (!supported) return;
      for (const color of COLORS) CSS.highlights.delete(`proto-hl-${color}`);
      CSS.highlights.delete('proto-flash');
    },
    [],
  );

  // Watch the selection inside the prose.
  useEffect(() => {
    if (!root) return;
    const read = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return null;
      if (!range.toString().trim()) return null;
      return range;
    };
    const up = () => {
      // Let the browser settle the selection first.
      setTimeout(() => {
        const range = read();
        if (!range) {
          setPending(null);
          return;
        }
        if (autoRef.current) {
          add(range, autoRef.current);
          return;
        }
        setPending({ rect: range.getBoundingClientRect(), range: range.cloneRange() });
      }, 0);
    };
    const down = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.proto-selection')) return;
      setPending(null);
    };
    root.addEventListener('mouseup', up);
    root.addEventListener('keyup', up);
    document.addEventListener('mousedown', down);
    return () => {
      root.removeEventListener('mouseup', up);
      root.removeEventListener('keyup', up);
      document.removeEventListener('mousedown', down);
    };
  }, [root, add]);

  // Keep the floating popover next to a selection that scrolls.
  useEffect(() => {
    if (!scroll || !pending) return;
    const follow = () =>
      setPending((current) =>
        current ? { ...current, rect: current.range.getBoundingClientRect() } : current,
      );
    scroll.addEventListener('scroll', follow, { passive: true });
    return () => scroll.removeEventListener('scroll', follow);
  }, [scroll, pending]);

  const jump = useCallback(
    (id: string) => {
      const item = items.find((entry) => entry.id === id);
      if (!item || !scroll) return;
      scrollToRange(scroll, item.range);
      if (!supported) return;
      CSS.highlights.set('proto-flash', new Highlight(item.range));
      setTimeout(() => CSS.highlights.delete('proto-flash'), 1400);
    },
    [items, scroll],
  );

  return {
    items,
    pending,
    clearPending: () => setPending(null),
    createPending: (color: HighlightColor, withNote = false) => {
      if (!pending) return;
      const item = add(pending.range, color);
      if (withNote) setEditing(item.id);
    },
    setNote: (id: string, note: string) =>
      setItems((current) => current.map((item) => (item.id === id ? { ...item, note } : item))),
    setColor: (id: string, color: HighlightColor) =>
      setItems((current) => current.map((item) => (item.id === id ? { ...item, color } : item))),
    remove: (id: string) => setItems((current) => current.filter((item) => item.id !== id)),
    jump,
    editing,
    setEditing,
    autoColor,
    setAutoColor,
    supported,
  };
}

export type HighlightsApi = ReturnType<typeof useHighlights>;
