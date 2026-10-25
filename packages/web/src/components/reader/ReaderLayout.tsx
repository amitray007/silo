import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useLink } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { ReaderPane } from './ReaderPane';
import { ReaderSelectionContext } from './ReaderSelection';
import { useReaderActions, useReaderKeyboard } from './useReaderActions';

/** Each route supplies its loaded pages. The reader never owns a second list. */
export function ReaderLayout({
  links,
  loading = false,
  trashed = false,
  purgeWindowDays = 30,
  title,
  children,
}: {
  links: LinkJson[];
  loading?: boolean;
  trashed?: boolean;
  purgeWindowDays?: number;
  title: string;
  children: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const locationKey = useRef(location.key);
  locationKey.current = location.key;
  const selectedId = params.get('link');
  const index = links.findIndex((link) => link.id === selectedId);
  const listed = links[index];
  const seen = useRef(new Set<string>());
  for (const link of links) seen.current.add(link.id);
  const detail = useLink(selectedId ?? undefined, {
    enabled: !trashed && !loading && !listed && !seen.current.has(selectedId ?? ''),
  });
  const resolved = listed ?? (trashed ? undefined : detail.data?.link);
  const previous = useRef<LinkJson | undefined>(undefined);
  if (resolved) previous.current = resolved;
  if (previous.current?.id !== selectedId) previous.current = undefined;
  const [view, setView] = useState<{ id: string | null; tab: 'reader' | 'original' }>({
    id: selectedId,
    tab: 'reader',
  });
  const tab = view.id === selectedId ? view.tab : 'reader';
  const setTab = useCallback(
    (tab: 'reader' | 'original') => setView({ id: selectedId, tab }),
    [selectedId],
  );
  const lastSelectedId = useRef(selectedId);
  const rootRef = useRef<HTMLDivElement>(null);

  const select = useCallback(
    (id: string) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set('link', id);
        return next;
      });
    },
    [setParams],
  );
  const close = useCallback(() => {
    // A late mutation response must not close a newer reader selection.
    if (locationKey.current !== location.key) return;
    setParams(
      (current) => {
        if (current.get('link') !== selectedId) return current;
        const next = new URLSearchParams(current);
        next.delete('link');
        return next;
      },
      { replace: true },
    );
  }, [setParams, selectedId, location.key]);
  const step = useCallback(
    (delta: number) => {
      const next = links[index < 0 ? 0 : index + delta];
      if (next) select(next.id);
    },
    [links, index, select],
  );
  const actions = useReaderActions(resolved ?? previous.current, trashed, close);
  useReaderKeyboard({
    step,
    close,
    toggleTab: () => setTab(tab === 'reader' ? 'original' : 'reader'),
    actions,
    trashed,
    selected: Boolean(selectedId),
  });
  useEffect(() => {
    if (!selectedId && lastSelectedId.current) {
      const row = rootRef.current?.querySelector<HTMLElement>(
        `[data-link-id="${CSS.escape(lastSelectedId.current)}"]`,
      );
      (row ?? rootRef.current?.querySelector<HTMLElement>('.silo-listpane'))?.focus();
    }
    lastSelectedId.current = selectedId;
    rootRef.current
      ?.querySelector(`[data-link-id="${CSS.escape(selectedId ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const selection = useMemo(() => ({ selectedId, select }), [selectedId, select]);
  return (
    <ReaderSelectionContext.Provider value={selection}>
      <div className="silo-three-pane" data-reader={Boolean(selectedId)} ref={rootRef}>
        <section tabIndex={-1} className="silo-listpane" aria-label={`${title} links`}>
          {children}
        </section>
        <ReaderPane
          link={resolved ?? (actions.busy ? previous.current : undefined)}
          selectedId={selectedId}
          tab={tab}
          setTab={setTab}
          close={close}
          step={step}
          index={index}
          count={links.length}
          actions={actions}
          trashed={trashed}
          purgeWindowDays={purgeWindowDays}
          title={title}
          loading={Boolean(selectedId) && (loading || detail.isFetching)}
        />
      </div>
    </ReaderSelectionContext.Provider>
  );
}
