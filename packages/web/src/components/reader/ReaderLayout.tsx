import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLink } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { layoutMedia, useMediaQuery } from '../../lib/breakpoints';
import { useListWidth } from '../../lib/useListWidth';
import { DeleteForeverDialog } from '../DeleteForeverDialog';
import { ListPaneDivider } from './ListPaneDivider';
import { ReaderPane } from './ReaderPane';
import { ReaderSelectionContext } from './ReaderSelection';
import { useReaderActions, useReaderKeyboard } from './useReaderActions';
import { useReaderNavigation } from './useReaderNavigation';

/** The first load of a link's detail. A refetch keeps showing the loaded article. */
function awaitingDetail(detail: { isFetching: boolean; data: unknown }): boolean {
  return detail.isFetching && !detail.data;
}

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
  const fullWindow = useMediaQuery(layoutMedia.fullWindowReader);
  const [listWidth] = useListWidth();
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
    tab: 'reader',
  });
  const tab = view.id === selectedId ? view.tab : 'reader';
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
    const activeRow = document.activeElement?.closest('.silo-row-wrap');
    if (selectedId && activeRow && !matchMedia(layoutMedia.fullWindowReader).matches) {
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
      <div
        className="silo-three-pane"
        data-reader={Boolean(selectedId)}
        ref={rootRef}
        style={{ '--list-w': `${listWidth}px` } as CSSProperties}
      >
        <section
          tabIndex={-1}
          className="silo-listpane"
          aria-label={`${title} links`}
          inert={fullWindow && Boolean(selectedId)}
        >
          {children}
        </section>
        <ListPaneDivider width={listWidth} fullWindow={fullWindow} />
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
          loading={Boolean(selectedId) && (loading || awaitingDetail(detail))}
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
