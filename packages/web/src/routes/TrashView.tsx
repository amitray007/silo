import {
  useBulkDeleteNow,
  useBulkRestore,
  useCounts,
  useEmptyTrash,
  useTrashList,
} from '../api/hooks';
import type { TrashLinkJson } from '../api/types';
import { ContentHeader } from '../components';
import { CenteredPanel } from '../components/CenteredPanel';
import {
  Dock,
  DockAction,
  DockDivider,
  DockIconAction,
  DockRestoreIcon,
  DockTrashIcon,
  SelectionDock,
} from '../components/Dock';
import { TrashIcon } from '../components/NavIcons';
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
    <SelectionDock selectedCount={selectedIds.length} onClear={selection.clear}>
      <DockIconAction onClick={handleRestore} icon={<DockRestoreIcon />} disabled={busy}>
        Restore
      </DockIconAction>
      <DockIconAction onClick={handleDeleteNow} icon={<DockTrashIcon />} disabled={busy}>
        Delete now
      </DockIconAction>
    </SelectionDock>
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
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fnt)', whiteSpace: 'nowrap' }}>
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
          fontWeight: 500,
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
}: {
  loading: boolean;
  isError: boolean;
  shownLinks: TrashLinkJson[];
  purgeWindowDays: number;
}) {
  if (loading) {
    return (
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
    );
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
        />
      ))}
    </>
  );
}

/**
 * `/trash` (plan 011, V3-5) — day-grouped trash rows with a purge countdown,
 * per-row restore/delete-now, and the bottom docks (idle "select all · empty
 * all" / selection "restore · delete now · clear"). The per-row
 * restore/delete-now mutations (`useRestoreLink`/`useDeleteNow`) live in
 * `TrashRowActions` (`TrashRow.tsx`), not here — this component only owns the
 * feed orchestration, the day-grouping, and the two bulk docks (rendering
 * itself delegated to `TrashBody`, kept in this file for its complexity
 * budget).
 *
 * The header's search input (`TrashSearchInput`, Trash search slice) was
 * REMOVED by a later user-feedback pass, mirroring the tag page's own
 * search-box removal (`TagView.tsx`'s doc comment): the command palette
 * (⌘K / `/`) handles trash search now, so `ContentHeader` here renders no
 * `children` — title+count only, same "no children" convention as
 * `SettingsView`/`TagView`.
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

  return (
    <>
      <ContentHeader title="Trash" count={links.length} />
      <div className="silo-content-body">
        <div className="silo-content-col silo-route-fade">
          <TrashBody
            loading={isLoading}
            isError={isError}
            shownLinks={links}
            purgeWindowDays={purgeWindowDays}
          />
        </div>
      </div>

      {hasSelection && <TrashSelectionDock selectedIds={selectedIds} />}
      {!hasSelection && links.length > 0 && (
        <TrashIdleDock purgeWindowDays={purgeWindowDays} allIds={links.map((l) => l.id)} />
      )}
    </>
  );
}
