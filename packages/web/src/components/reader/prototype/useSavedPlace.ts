// THROWAWAY: one local sentence per link. Only explicit stops write it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { paragraphSections } from './paragraphs.prototype';
import { buildSegments } from './useReadAloud';

export type SavedPlace = {
  paragraph: number;
  source: 'manual' | 'listen' | 'pencil';
  sentence?: number | undefined;
  progress: number;
};

export function useSavedPlace(prose: HTMLElement | null, scroll: HTMLElement) {
  const [params] = useSearchParams();
  const style =
    params.get('mark') === 'line'
      ? 'line'
      : params.get('mark') === 'ribbon'
        ? 'ribbon'
        : 'sentence';
  const key = `silo.proto.place.${params.get('link')}`;
  const [saved, setSaved] = useState<SavedPlace | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  });
  const [continuing, setContinuing] = useState(Boolean(saved));
  const [hover, setHover] = useState<Element | null>(null);
  const [anchor, setAnchor] = useState<{ y: number } | null>(null);
  const [tint, setTint] = useState(1);
  const [pulse, setPulse] = useState(0);
  const paragraphs = useMemo(() => (prose ? paragraphSections(prose) : []), [prose]);
  const segments = useMemo(() => (prose ? buildSegments(prose) : []), [prose]);
  const segment =
    saved &&
    (segments[saved.sentence ?? -1] ??
      segments.find((s) => paragraphs[saved.paragraph]?.contains(s.block)));
  const hoverSegment = hover && segments.find((s) => hover.contains(s.block));
  const target = hoverSegment ?? segment;
  const save = useCallback(
    (block: Element | undefined, source: SavedPlace['source'], sentence?: number) => {
      if (!block || !prose) return;
      const paragraph = paragraphs.findIndex((el) => el === block || el.contains(block));
      if (paragraph < 0) return;
      const at = sentence ?? segments.findIndex((s) => block.contains(s.block));
      const total = paragraphs.reduce((n, el) => n + (el.textContent?.length ?? 0), 0);
      const before = paragraphs
        .slice(0, paragraph)
        .reduce((n, el) => n + (el.textContent?.length ?? 0), 0);
      const next = {
        paragraph,
        source,
        sentence: Math.max(0, at),
        progress: Math.round((before / (total || 1)) * 100),
      };
      setSaved(next);
      setHover(null);
      setTint(1);
      setContinuing(false);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* In-memory state is enough. */
      }
    },
    [key, paragraphs, prose, segments],
  );

  useLayoutEffect(() => {
    if (!prose) return;
    let frame = 0;
    const measure = () => {
      const rect = target?.range.getClientRects()[0];
      const y = rect
        ? rect.top - scroll.getBoundingClientRect().top + scroll.scrollTop + rect.height / 2
        : null;
      setAnchor((old) => (y === null ? null : old?.y === y ? old : { y }));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(prose);
    observer.observe(scroll);
    const changes = new MutationObserver(schedule);
    changes.observe(prose.closest('.silo-reader') ?? prose, {
      attributes: true,
      subtree: true,
      attributeFilter: ['style'],
    });
    document.fonts.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      changes.disconnect();
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [prose, scroll, target]);

  useEffect(() => {
    if (!segment || !prose || style !== 'sentence' || !('highlights' in CSS)) return;
    CSS.highlights.set('proto-place', new Highlight(segment.range));
    return () => {
      CSS.highlights.delete('proto-place');
    };
  }, [segment, prose, style]);

  // CSS Custom Highlight colours are driven by a short opacity fade, without wrapping prose.
  useEffect(() => {
    if (!prose) return;
    const from = Number.parseFloat(prose.style.getPropertyValue('--place-opacity')) || 0;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 1
        : Math.min(1, (now - start) / 240);
      prose.style.setProperty('--place-opacity', String(from + (tint - from) * t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tint, prose]);

  useEffect(() => {
    if (!segment) return;
    const dismiss = () => {
      const rect = segment.range.getBoundingClientRect();
      const box = scroll.getBoundingClientRect();
      if (rect.bottom < box.top + 24) {
        setTint(0);
        setContinuing(false);
      }
    };
    dismiss();
    scroll.addEventListener('scroll', dismiss, { passive: true });
    return () => scroll.removeEventListener('scroll', dismiss);
  }, [segment, scroll]);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setTint(0), 1400);
    return () => clearTimeout(timer);
  }, [pulse]);

  const remove = () => {
    setSaved(null);
    setHover(null);
    setContinuing(false);
    try {
      localStorage.removeItem(key);
    } catch {
      /* In-memory state is enough. */
    }
  };
  const continueFrom = () => {
    setTint(0);
    setContinuing(false);
  };
  const jump = () => {
    const rect = segment?.range.getClientRects()[0];
    if (!rect) return;
    scroll.scrollTo({
      top:
        scroll.scrollTop + rect.top - scroll.getBoundingClientRect().top - scroll.clientHeight / 3,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    setContinuing(false);
    setTint(1);
    setPulse((value) => value + 1);
  };
  return {
    saved,
    paragraphs,
    segments,
    segment,
    save,
    remove,
    continuing,
    jump,
    continueFrom,
    hover,
    setHover,
    anchor,
    style,
  };
}
export type SavedPlaceApi = ReturnType<typeof useSavedPlace>;
