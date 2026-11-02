import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReadingPositionJson } from '../../../api/types';
import { blocked } from '../dock/keyGuards';
import { paragraphSections } from '../highlights/paragraphs';
import { useProseVersion } from './proseVersion';
import { articleWordIndex } from './words';

/** Resolve one persisted word share into its paragraph without changing the prose DOM. */
export function useSavedPlace({
  prose,
  scroll,
  saved,
  onSave,
}: {
  prose: HTMLElement;
  scroll: HTMLElement;
  saved: ReadingPositionJson | null;
  onSave: (position: number | null) => Promise<void>;
}) {
  const version = useProseVersion(prose);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version tracks replaced prose nodes.
  const paragraphs = useMemo(() => paragraphSections(prose), [prose, version]);
  const words = articleWordIndex(prose);
  const word = saved ? words.atShare(saved.position) : undefined;
  const block = paragraphs.find((paragraph) => word && paragraph.contains(word.startContainer));
  const [hover, setHover] = useState<Element | null>(null);
  const identity = saved ? `${saved.source}:${Math.round(saved.position * 1e6)}` : '';
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [offscreen, setOffscreen] = useState(false);
  const save = useCallback(
    (paragraph: Element) => {
      setHover(null);
      void onSave(words.shareAtBlock(paragraph)).catch(() => {});
    },
    [words, onSave],
  );

  useEffect(() => {
    if (!block) {
      setOffscreen(false);
      return;
    }
    const bounds = () => {
      const range = document.createRange();
      range.selectNodeContents(block);
      return range.getClientRects()[0] ?? block.getBoundingClientRect();
    };
    let previousBottom = bounds().bottom;
    const measure = () => {
      const rect = bounds();
      const box = scroll.getBoundingClientRect();
      setOffscreen(rect.bottom < box.top + 24 || rect.top > box.bottom - 80);
      previousBottom = rect.bottom;
    };
    measure();
    const onScroll = () => {
      const crossed = previousBottom >= scroll.getBoundingClientRect().top + 24;
      measure();
      if (crossed && bounds().bottom < scroll.getBoundingClientRect().top + 24 && saved)
        setDismissed(identity);
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(prose);
    return () => {
      scroll.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [block, saved, identity, scroll, prose]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        saved &&
        offscreen &&
        dismissed !== identity &&
        !blocked(event)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setDismissed(identity);
        return;
      }
      if (blocked(event) || event.repeat || event.key.toLowerCase() !== 'b') return;
      const top = scroll.getBoundingClientRect().top + 24;
      const nearest = paragraphs
        .filter((el) => el.tagName === 'P')
        .sort(
          (a, b) =>
            Math.abs(a.getBoundingClientRect().top - top) -
            Math.abs(b.getBoundingClientRect().top - top),
        )[0];
      if (nearest) {
        event.preventDefault();
        event.stopPropagation();
        save(nearest);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [paragraphs, save, scroll, saved, identity, offscreen, dismissed]);

  const dismiss = () => {
    if (saved) setDismissed(identity);
  };
  const jump = () => {
    if (!block) return;
    const box = scroll.getBoundingClientRect();
    scroll.scrollTo({
      top: scroll.scrollTop + block.getBoundingClientRect().top - box.top - scroll.clientHeight / 3,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    dismiss();
  };
  return {
    saved,
    paragraphs,
    block,
    hover,
    setHover,
    save,
    jump,
    dismiss,
    remove: () => {
      setHover(null);
      void onSave(null).catch(() => {});
    },
    continuing: Boolean(saved && offscreen && dismissed !== identity),
  };
}
