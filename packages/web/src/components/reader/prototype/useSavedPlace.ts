// THROWAWAY: one local place per link. Only explicit stops write it; scrolling never does.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { paragraphSections } from './paragraphs.prototype';

export type SavedPlace = {
  paragraph: number;
  source: 'manual' | 'listen' | 'pencil';
  sentence?: number | undefined;
  progress: number;
};

export function useSavedPlace(prose: HTMLElement | null, scroll: HTMLElement) {
  const [params] = useSearchParams();
  const key = `silo.proto.place.${params.get('link')}`;
  const [saved, setSaved] = useState<SavedPlace | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  });
  const [continuing, setContinuing] = useState(Boolean(saved));
  const paragraphs = useMemo(() => (prose ? paragraphSections(prose) : []), [prose]);
  const save = useCallback(
    (block: Element | undefined, source: SavedPlace['source'], sentence?: number) => {
      if (!block || !prose) return;
      const paragraph = paragraphs.findIndex((el) => el === block || el.contains(block));
      if (paragraph < 0) return;
      const total = paragraphs.reduce((n, el) => n + (el.textContent?.length ?? 0), 0);
      const before = paragraphs
        .slice(0, paragraph)
        .reduce((n, el) => n + (el.textContent?.length ?? 0), 0);
      const next = {
        paragraph,
        source,
        sentence,
        progress: Math.round((before / (total || 1)) * 100),
      };
      setSaved(next);
      setContinuing(false);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* In-memory state is enough for the mockup. */
      }
    },
    [key, paragraphs, prose],
  );
  const remove = () => {
    setSaved(null);
    setContinuing(false);
    localStorage.removeItem(key);
  };
  useEffect(() => {
    if (!continuing || !saved) return;
    const dismiss = () => {
      const block = paragraphs[saved.paragraph];
      if (block && block.getBoundingClientRect().top < scroll.getBoundingClientRect().top + 24)
        setContinuing(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setContinuing(false);
    };
    scroll.addEventListener('scroll', dismiss, { passive: true });
    window.addEventListener('keydown', onEscape, true);
    return () => {
      scroll.removeEventListener('scroll', dismiss);
      window.removeEventListener('keydown', onEscape, true);
    };
  }, [continuing, saved, paragraphs, scroll]);
  const jump = () => {
    const block = saved && paragraphs[saved.paragraph];
    if (!block) return;
    scroll.scrollTo({
      top:
        scroll.scrollTop +
        block.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top -
        100,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    setContinuing(false);
  };
  return { saved, paragraphs, save, remove, continuing, jump };
}

export type SavedPlaceApi = ReturnType<typeof useSavedPlace>;
