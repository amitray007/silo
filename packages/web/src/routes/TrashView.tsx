import { useState } from 'react';
import {
  useBulkDeleteNow,
  useBulkRestore,
  useCounts,
  useDeleteNow,
  useEmptyTrash,
  useTrashList,
} from '../api/hooks';
import type { TrashLinkJson } from '../api/types';
import { ContentHeader } from '../components';
import { CenteredPanel } from '../components/CenteredPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DeleteForeverDialog } from '../components/DeleteForeverDialog';
import {
  DockAction,
  DockIconAction,
  DockRestoreIcon,
  DockTrashIcon,
  SelectionDock,
} from '../components/Dock';
import { TrashIcon } from '../components/NavIcons';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { useTrashSelection } from '../components/SelectionContext';
import { TrashDayGroup } from '../components/TrashDayGroup';
import { bucketTrashByDay } from '../lib/buckets';
import { LoadingState } from './shared/ListStates';

/**
 * The trash selection dock (v3's `trSelActive`, `Silo-v3.html:296-305`) — "N
 * selected · restore · delete now · clear · esc". Bulk restore/delete-now
 * loop the single-item endpoints via `useBulkRestore`/`useBulkDeleteNow`
 * (`runBulk`, `api/hooks.ts`) since there's no bulk API; both clear the
 * batch's ids on settle — via `deselect(batch)`, NOT a whole `clear()`, so a
 * row the user selects WHILE the bulk op is still in flight isn't wiped out
 * with it (review fix). A partial failure just leaves that id in the trash
 * list, which the invalidate-driven refetch reconciles — see those hooks' doc
 * comments for why a plain settle-invalidate is enough here. Both actions are
 * disabled while their batch is pending so a double-click can't fire a second
 * overlapping batch against the same (possibly already-deleted) ids.
 */
function TrashSelectionDock({ selectedIds, allIds }: { selectedIds: string[]; allIds: string[] }) {
  const selection = useTrashSelection();
  const bulkRestore = useBulkRestore();
  const bulkDeleteNow = useBulkDeleteNow();
  const [deleteBatch, setDeleteBatch] = useState<string[] | null>(null);
  const busy = bulkRestore.isPending || bulkDeleteNow.isPending;

  const handleRestore = () => {
    if (busy) return;
    const batch = selectedIds;
    bulkRestore.mutate(batch, { onSettled: () => selection.deselect(batch) });
  };

  const handleDeleteNow = () => {
    if (busy) return;
    if (!deleteBatch) return;
    const batch = deleteBatch;
    bulkDeleteNow.mutate(batch, {
      onSettled: () => {
        selection.deselect(batch);
        setDeleteBatch(null);
      },
    });
  };

  return (
    <>
      <SelectionDock selectedCount={selectedIds.length} onClear={selection.clear}>
        <DockAction onClick={() => selection.selectAll(allIds)}>Select all</DockAction>
        <DockIconAction onClick={handleRestore} icon={<DockRestoreIcon />} disabled={busy}>
          Restore
        </DockIconAction>
        <DockIconAction
          onClick={() => setDeleteBatch([...selectedIds])}
          icon={<DockTrashIcon />}
          disabled={busy}
        >
          Delete now
        </DockIconAction>
      </SelectionDock>
      {deleteBatch && (
        <DeleteForeverDialog
          count={deleteBatch.length}
          pending={bulkDeleteNow.isPending}
          onConfirm={handleDeleteNow}
          onClose={() => setDeleteBatch(null)}
        />
      )}
    </>
  );
}

function TrashEmptyNowButton() {
  const emptyTrash = useEmptyTrash();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button
        type="button"
        className="silo-reader-btn silo-empty-trash"
        onClick={() => setConfirming(true)}
        disabled={emptyTrash.isPending}
        title="Permanently empty the trash"
        aria-label="Empty trash"
      >
        <TrashIcon size={16} stroke="currentColor" />
        Empty trash
      </button>
      {confirming && (
        <ConfirmDialog
          title="Empty trash?"
          action="Empty trash"
          actionLabel="Confirm emptying the trash"
          pending={emptyTrash.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() => emptyTrash.mutate(undefined, { onSettled: () => setConfirming(false) })}
        >
          All links in trash will be deleted forever. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * The trash empty state — a proper centered composition (user feedback:
 * "add a better empty state for trash"), matching the Library's rich
 * `EmptyState` shell (`CenteredPanel` + mark + headline + body) rather than
 * the previous bare left-aligned line. Uses the trash-can mark (a permitted
 * icon) instead of the grain dot, and the body explains the auto-empty
 * behavior so an empty trash reads as reassuring, not blank.
 */
function TrashEmptyState({ purgeWindowDays }: { purgeWindowDays: number }) {
  return (
    <CenteredPanel>
      <span style={{ color: 'var(--fnt)', display: 'inline-flex' }}>
        <TrashIcon size={26} stroke="currentColor" />
      </span>
      <p
        style={{
          margin: 'var(--s5) 0 0',
          fontSize: 'var(--text-md)',
          fontWeight: 600,
          color: 'var(--ink)',
          letterSpacing: 'var(--tracking-tight)',
          textWrap: 'balance',
        }}
      >
        Trash is empty
      </p>
      <p
        style={{
          margin: 'var(--s1-5) 0 0',
          fontSize: 'var(--text-sm)',
          color: 'var(--mut)',
          maxWidth: '30ch',
          lineHeight: 'var(--lh-snug)',
          textWrap: 'pretty',
        }}
      >
        Deleted links land here and keep their text. They auto-empty after {purgeWindowDays} days.
      </p>
    </CenteredPanel>
  );
}

/**
 * The Trash body's loading/error/empty/results branches — pulled out of
 * `TrashView` itself so that component's own complexity stays under the lint
 * gate. Search removed (later user-feedback pass, mirroring the Library's own
 * omnibar-search removal): the header's search input is gone — trash search
 * now lives entirely in the command palette (⌘K / `/`) — so this only ever
 * renders the plain day-grouped browse feed.
 */
function TrashBody({
  loading,
  isError,
  shownLinks,
  purgeWindowDays,
  onDelete,
}: {
  loading: boolean;
  isError: boolean;
  shownLinks: TrashLinkJson[];
  purgeWindowDays: number;
  onDelete: (id: string) => void;
}) {
  // Reuse the shared list `LoadingState` (Library/Tag) — Trash is also
  // day-grouped (`TrashDayGroup` → the same `DayGroupHeading`) and `TrashRow`
  // shares `.silo-link-row`'s exact 10px padding / 12px gap / 18px favicon
  // anatomy (the K3 oat-conformance alignment), so the same CLS-correct
  // heading+row skeleton fits Trash with no drift — no reason to hand-roll a
  // second, different loader here (the old flat blocks it replaces did drift).
  if (loading) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <p
        style={{
          padding: '40px 11px',
          margin: 0,
          fontSize: 'var(--text-sm)',
          color: 'var(--warn)',
        }}
      >
        Couldn't load the trash.
      </p>
    );
  }

  if (shownLinks.length === 0) {
    return <TrashEmptyState purgeWindowDays={purgeWindowDays} />;
  }

  return (
    <>
      {bucketTrashByDay(shownLinks).map((group) => (
        <TrashDayGroup
          key={group.label}
          label={group.label}
          links={group.items}
          purgeWindowDays={purgeWindowDays}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

/** Trash keeps its list, bulk actions, and purge policy beside the shared reader. */
export function TrashView() {
  const { data: counts } = useCounts();
  const { data, isLoading, isError } = useTrashList();
  const selection = useTrashSelection();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const remove = useDeleteNow(deleteId ?? '');

  const links = data?.links ?? [];
  const purgeWindowDays = counts?.purgeWindowDays ?? 30;
  const selectedIds = selection.selected;
  const hasSelection = selectedIds.length > 0;

  // Escape is handled centrally by `AppFrame`'s `RowMenuLayer` (closes the
  // row `⋯` menu first if one is open, otherwise clears this scope's
  // selection) — see that component's doc comment. No listener needed here.

  return (
    <ReaderLayout
      links={links}
      loading={isLoading}
      title="Trash"
      trashed
      purgeWindowDays={purgeWindowDays}
    >
      <ContentHeader title="Trash" count={counts?.trash}>
        {links.length > 0 && <TrashEmptyNowButton />}
      </ContentHeader>
      <div className="silo-content-body">
        <div className="silo-content-col silo-route-fade">
          {links.length > 0 && (
            <p className="silo-hint-line">
              Deleted links keep their text - auto-empties after {purgeWindowDays} days
            </p>
          )}
          <TrashBody
            loading={isLoading}
            isError={isError}
            shownLinks={links}
            purgeWindowDays={purgeWindowDays}
            onDelete={setDeleteId}
          />
        </div>
      </div>

      {deleteId && (
        <DeleteForeverDialog
          pending={remove.isPending}
          onClose={() => setDeleteId(null)}
          onConfirm={() =>
            remove.mutate(undefined, {
              onSuccess: () => selection.deselect([deleteId]),
              onSettled: () => setDeleteId(null),
            })
          }
        />
      )}
      {hasSelection && (
        <TrashSelectionDock selectedIds={selectedIds} allIds={links.map((link) => link.id)} />
      )}
    </ReaderLayout>
  );
}
