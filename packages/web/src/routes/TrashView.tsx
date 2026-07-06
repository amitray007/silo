import {
  useBulkDeleteNow,
  useBulkRestore,
  useCounts,
  useEmptyTrash,
  useTrashList,
} from '../api/hooks';
import { ContentHeader } from '../components';
import {
  Dock,
  DockAction,
  DockDivider,
  DockEscHint,
  DockIconAction,
  DockRestoreIcon,
  DockSelectedLabel,
  DockTrashIcon,
} from '../components/Dock';
import { useTrashSelection } from '../components/SelectionContext';
import { TrashDayGroup } from '../components/TrashDayGroup';
import { bucketTrashByDay } from '../lib/buckets';

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
function TrashSelectionDock({ selectedIds }: { selectedIds: string[] }) {
  const selection = useTrashSelection();
  const bulkRestore = useBulkRestore();
  const bulkDeleteNow = useBulkDeleteNow();
  const busy = bulkRestore.isPending || bulkDeleteNow.isPending;

  const handleRestore = () => {
    if (busy) return;
    const batch = selectedIds;
    bulkRestore.mutate(batch, { onSettled: () => selection.deselect(batch) });
  };

  const handleDeleteNow = () => {
    if (busy) return;
    const batch = selectedIds;
    bulkDeleteNow.mutate(batch, { onSettled: () => selection.deselect(batch) });
  };

  return (
    <Dock>
      <DockSelectedLabel count={selectedIds.length} />
      <DockDivider />
      <DockIconAction onClick={handleRestore} icon={<DockRestoreIcon />} disabled={busy}>
        Restore
      </DockIconAction>
      <DockIconAction onClick={handleDeleteNow} icon={<DockTrashIcon />} disabled={busy}>
        Delete now
      </DockIconAction>
      <DockAction onClick={selection.clear}>Clear</DockAction>
      <DockEscHint />
    </Dock>
  );
}

/**
 * The idle trash dock (v3's `trDockIdle`, `Silo-v3.html:288-295`) —
 * "{trashLine} · select all · empty all", shown whenever the trash is
 * non-empty and nothing is selected. `trashLine` matches v3's copy exactly
 * (`Silo-v3.html:1037`): "deleted links keep their text · auto-empties after
 * {purgeWindowDays} days".
 */
function TrashIdleDock({ purgeWindowDays, allIds }: { purgeWindowDays: number; allIds: string[] }) {
  const selection = useTrashSelection();
  const emptyTrash = useEmptyTrash();

  return (
    <Dock padding="9px 18px">
      <span style={{ fontSize: '0.74rem', color: 'var(--fnt)', whiteSpace: 'nowrap' }}>
        Deleted links keep their text · auto-empties after {purgeWindowDays} days
      </span>
      <DockDivider />
      <DockAction onClick={() => selection.selectAll(allIds)}>Select all</DockAction>
      <DockIconAction
        onClick={() => {
          if (!emptyTrash.isPending) emptyTrash.mutate();
        }}
        icon={<DockTrashIcon />}
        disabled={emptyTrash.isPending}
      >
        Empty all
      </DockIconAction>
    </Dock>
  );
}

/** v3's `trashEmpty` copy (`Silo-v3.html:198-200`) — a plain left-aligned line, matching the Library's `noResults` treatment rather than the full centered `EmptyState` (reserved for "nothing in the whole store"). */
function TrashEmptyState() {
  return (
    <p style={{ padding: '40px 11px', margin: 0, fontSize: '0.82rem', color: 'var(--fnt)' }}>
      Trash is empty.
    </p>
  );
}

/**
 * `/trash` (plan 011, V3-5) — day-grouped trash rows with a purge countdown,
 * per-row restore/delete-now, and the bottom docks (idle "select all · empty
 * all" / selection "restore · delete now · clear"). Real hooks/data land here
 * for the first time, superseding the `ComingSoon` stub from W5. The
 * per-row restore/delete-now mutations (`useRestoreLink`/`useDeleteNow`) live
 * in `TrashRowActions` (`TrashRow.tsx`), not here — this component only owns
 * the feed, the day-grouping, and the two bulk docks.
 */
export function TrashView() {
  const { data: counts } = useCounts();
  const { data, isLoading, isError } = useTrashList();
  const selection = useTrashSelection();

  const links = data?.links ?? [];
  const purgeWindowDays = counts?.purgeWindowDays ?? 30;
  const selectedIds = selection.selected;
  const hasSelection = selectedIds.length > 0;

  // Escape is handled centrally by `AppFrame`'s `RowMenuLayer` (closes the
  // row `⋯` menu first if one is open, otherwise clears this scope's
  // selection) — see that component's doc comment. No listener needed here.

  const groups = bucketTrashByDay(links);

  return (
    <>
      <ContentHeader title="Trash" count={links.length} />
      <div className="silo-content-body">
        <div className="silo-content-col silo-route-fade">
          {isLoading && (
            <div style={{ padding: '20px 11px' }} role="status" aria-label="Loading…">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 34,
                    borderRadius: 8,
                    background: 'var(--bg2)',
                    marginBottom: 8,
                    opacity: 0.6,
                  }}
                />
              ))}
            </div>
          )}
          {!isLoading && isError && (
            <p
              style={{ padding: '40px 11px', margin: 0, fontSize: '0.82rem', color: 'var(--warn)' }}
            >
              Couldn't load the trash.
            </p>
          )}
          {!isLoading &&
            !isError &&
            (links.length === 0 ? (
              <TrashEmptyState />
            ) : (
              groups.map((group) => (
                <TrashDayGroup
                  key={group.label}
                  label={group.label}
                  links={group.items}
                  purgeWindowDays={purgeWindowDays}
                />
              ))
            ))}
        </div>
      </div>

      {hasSelection && <TrashSelectionDock selectedIds={selectedIds} />}
      {!hasSelection && links.length > 0 && (
        <TrashIdleDock purgeWindowDays={purgeWindowDays} allIds={links.map((l) => l.id)} />
      )}
    </>
  );
}
