import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLink } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { DeleteForeverDialog } from '../DeleteForeverDialog';
import { ReaderPane } from './ReaderPane';
import { ReaderSelectionContext } from './ReaderSelection';
import { useReaderActions, useReaderKeyboard } from './useReaderActions';
import { useReaderNavigation } from './useReaderNavigation';

/** Each route supplies its loaded pages. The reader never owns a second list. */
export function ReaderLayout({
  links,
  loading = false,
  trashed = false,
  purgeWindowDays = 30,
  title,
  children,
  hasNextPage = false,
  fetchNextPage,
}: {
  links: LinkJson[];
  loading?: boolean;
  trashed?: boolean;
  purgeWindowDays?: number;
  title: string;
  children: ReactNode;
  hasNextPage?: boolean;
  fetchNextPage?: () => Promise<LinkJson[]>;
}) {
  const { selectedId, index, select, close, removed, step, advancing } = useReaderNavigation({
    links,
    loading,
    hasNextPage,
    fetchNextPage,
  });
  const listed = links[index];
  const detail = useLink(selectedId ?? undefined, {
    enabled: !trashed && !loading,
  });
  const resolved = trashed ? listed : (detail.data?.link ?? listed);
  const previous = useRef<LinkJson | undefined>(undefined);
  if (resolved) previous.current = resolved;
  if (previous.current?.id !== selectedId) previous.current = undefined;
  const [view, setView] = useState<{ id: string | null; tab: 'reader' | 'original' }>({
    id: selectedId,
    tab: 'original',
  });
  const tab = view.id === selectedId ? view.tab : 'original';
  const setTab = useCallback(
    (tab: 'reader' | 'original') => setView({ id: selectedId, tab }),
    [selectedId],
  );
  const lastSelectedId = useRef(selectedId);
  const rootRef = useRef<HTMLDivElement>(null);

  const actions = useReaderActions(resolved ?? previous.current, trashed, removed);
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
    const activeRow = document.activeElement?.closest('.silo-link-row');
    if (selectedId && activeRow && !matchMedia('(max-width: 719px)').matches) {
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-link-id="${CSS.escape(selectedId)}"]`)
        ?.focus();
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
          link={resolved ?? previous.current}
          selectedId={selectedId}
          tab={tab}
          setTab={setTab}
          close={close}
          step={step}
          index={index}
          canGoNext={index >= 0 && (index < links.length - 1 || hasNextPage) && !advancing}
          actions={actions}
          trashed={trashed}
          purgeWindowDays={purgeWindowDays}
          title={title}
          loading={Boolean(selectedId) && (loading || detail.isFetching)}
        />
        <ReaderDeleteDialog actions={actions} link={resolved ?? previous.current} />
      </div>
    </ReaderSelectionContext.Provider>
  );
}

function ReaderDeleteDialog({
  actions,
  link,
}: {
  actions: ReturnType<typeof useReaderActions>;
  link: LinkJson | undefined;
}) {
  return actions.confirmingDelete ? (
    <DeleteForeverDialog
      link={link}
      pending={actions.busy}
      onConfirm={actions.confirmDelete}
      onClose={actions.cancelDelete}
    />
  ) : null;
}
