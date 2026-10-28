import { useLayoutEffect, useRef, useState } from 'react';
import type { LinkJson } from '../api/types';
import { deriveTitleFromUrl } from './url';

type ShownTitle = { title: string; enriching: boolean; placeholder: boolean };

// Survives row unmounts. Only an already-mounted row can consume a transition.
const shownTitles = new Map<string, ShownTitle>();

export function useTitleReveal(link: LinkJson) {
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const enriching = link.captureStatus === 'enriching';
  const placeholder =
    !link.title || link.title === link.url || link.title === deriveTitleFromUrl(link.url);
  const mountedId = useRef<string | null>(null);
  const [reveal, setReveal] = useState<{ id: string; title: string } | null>(null);

  useLayoutEffect(() => {
    const previous = shownTitles.get(link.id);
    const play =
      mountedId.current === link.id &&
      previous !== undefined &&
      (previous.enriching || previous.placeholder) &&
      !enriching &&
      previous.title !== title;

    shownTitles.set(link.id, { title, enriching, placeholder });
    mountedId.current = link.id;
    setReveal(play ? { id: link.id, title } : null);
  }, [link.id, title, enriching, placeholder]);

  return reveal?.id === link.id && reveal.title === title;
}
