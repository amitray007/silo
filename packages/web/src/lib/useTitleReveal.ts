import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LinkJson } from '../api/types';
import {
  clearTitleReveal,
  getTitleReveal,
  mountTitleRow,
  subscribeTitleReveals,
} from './titleReveals';
import { deriveTitleFromUrl } from './url';

export function useTitleReveal(link: LinkJson) {
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const enriching = link.captureStatus === 'enriching';
  const pending = useSyncExternalStore(
    subscribeTitleReveals,
    () => getTitleReveal(link.id),
    () => undefined,
  );
  const previous = useRef<{ id: string; title: string; enriching: boolean } | null>(null);
  const [reveal, setReveal] = useState<{ id: string; title: string } | null>(null);

  useLayoutEffect(() => mountTitleRow(link.id, title), [link.id, title]);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { id: link.id, title, enriching };
    if (pending?.kind === 'edit') {
      setReveal(null);
      return;
    }
    if (!pending) return;
    pending.visible = true;
    const allowInitialReveal = pending.allowInitialReveal;
    pending.allowInitialReveal = false;
    const mounted = before?.id === link.id;
    pending.baselineTitle ??= title;
    // A dedup capture can stay full throughout. Its unchanged save response
    // is not a settlement signal; wait for a title change or the entry's TTL.
    const settled =
      !enriching &&
      (!mounted ||
        allowInitialReveal ||
        before.enriching ||
        before.title !== title ||
        pending.baselineTitle !== title);
    if (settled) {
      clearTitleReveal(link.id);
      setReveal(
        (mounted || allowInitialReveal) && pending.baselineTitle !== title
          ? { id: link.id, title }
          : null,
      );
    }
    return () => {
      pending.visible = false;
    };
  }, [link.id, title, enriching, pending]);

  return reveal?.id === link.id && reveal.title === title;
}
