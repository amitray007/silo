import { useIsMutating } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import type { LinkJson } from '../../api/types';
import { useHoverPreview } from '../HoverPreviewContext';

/** Pick the next surviving neighbor, then the previous one, after a removal. */
function neighbor(before: LinkJson[], id: string, after: LinkJson[]) {
  const index = before.findIndex((link) => link.id === id);
  const surviving = new Set(after.filter((link) => link.id !== id).map((link) => link.id));
  const next = before.slice(index + 1).find((link) => surviving.has(link.id));
  return (
    next ??
    before
      .slice(0, index)
      .reverse()
      .find((link) => surviving.has(link.id))
  );
}

export function useReaderNavigation({
  links,
  loading,
  hasNextPage,
  fetchNextPage,
}: {
  links: LinkJson[];
  loading: boolean;
  hasNextPage: boolean;
  fetchNextPage: (() => Promise<LinkJson[]>) | undefined;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const currentKey = useRef(location.key);
  currentKey.current = location.key;
  const selectedId = params.get('link');
  const index = links.findIndex((link) => link.id === selectedId);
  const { dismissAll } = useHoverPreview();
  const mutations = useIsMutating();
  const snapshot = useRef({ id: selectedId, path: location.pathname, links });
  const fetching = useRef(false);
  const [advancing, setAdvancing] = useState(false);

  const replace = useCallback(
    (id: string | undefined) => {
      if (currentKey.current !== location.key) return;
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (id) next.set('link', id);
          else next.delete('link');
          return next;
        },
        { replace: true },
      );
    },
    [setParams, location.key],
  );
  const close = useCallback(() => replace(undefined), [replace]);
  const select = useCallback(
    (id: string) => {
      dismissAll();
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set('link', id);
        return next;
      });
    },
    [setParams, dismissAll],
  );
  const removed = useCallback(() => {
    if (selectedId) replace(neighbor(links, selectedId, links)?.id);
  }, [selectedId, links, replace]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: browser history selection changes dismiss the preview too.
  useEffect(() => {
    dismissAll();
  }, [selectedId, dismissAll]);
  useEffect(() => {
    if (index >= 0) {
      snapshot.current = { id: selectedId, path: location.pathname, links };
      return;
    }
    const before = snapshot.current;
    if (loading || mutations || !selectedId) return;
    if (before.id !== selectedId || before.path !== location.pathname) return;
    // An optimistic removal can roll back. Wait for mutations to settle before replacing history.
    if (before.links.some((link) => link.id === selectedId))
      replace(neighbor(before.links, selectedId, links)?.id);
  }, [links, index, selectedId, loading, mutations, location.pathname, replace]);

  const step = useCallback(
    async (delta: number) => {
      dismissAll();
      const next = links[index < 0 ? 0 : index + delta];
      if (next) {
        select(next.id);
        return;
      }
      if (delta < 0 || !hasNextPage || !fetchNextPage || fetching.current) return;
      fetching.current = true;
      setAdvancing(true);
      try {
        const loaded = await fetchNextPage();
        if (currentKey.current !== location.key) return;
        const next = loaded[loaded.findIndex((link) => link.id === selectedId) + 1];
        if (next) select(next.id);
      } finally {
        fetching.current = false;
        setAdvancing(false);
      }
    },
    [links, index, selectedId, select, dismissAll, hasNextPage, fetchNextPage, location.key],
  );

  return { selectedId, index, select, close, removed, step, advancing };
}
