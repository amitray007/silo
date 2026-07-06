import { useState } from 'react';
import {
  useBulkDeleteNow,
  useBulkRestore,
  useCounts,
  useEmptyTrash,
  useSearchTrash,
  useTrashList,
} from '../api/hooks';
import type { TrashLinkJson, TrashSearchResultJson } from '../api/types';
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
import { SearchIcon, TrashIcon } from '../components/NavIcons';
import { useTrashSelection } from '../components/SelectionContext';
import { TrashDayGroup } from '../components/TrashDayGroup';
import { bucketTrashByDay } from '../lib/buckets';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { NoSearchResults } from './shared/ListStates';

/** Matches the omnibar's search debounce (`useOmnibarState.ts`'s `SEARCH_DEBOUNCE_MS`) — kept as its own constant here since this input has no shared state hook of its own. */
const TRASH_SEARCH_DEBOUNCE_MS = 200;

/**
 * The Trash screen's search-only input (Trash search slice) — deliberately
 * NOT the full `Omnibar` (that component is coupled to keep/URL/tag
 * semantics this screen doesn't have), but matching its LOOK exactly: the
 * same `--bg2` rounded field, the same magnifier SVG (copied verbatim from
 * `Omnibar.tsx`), the same enlarged padding/width clamp. A controlled input;
 * the raw value is always what's displayed, same discipline as the omnibar's
 * `q`/`debouncedQ` split (debouncing only ever gates the network request,
 * never the visible keystroke).
 */
function TrashSearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div
      style={{
        width: 'clamp(320px, 52%, 620px)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2-5)',
        border: '1px solid var(--line)',
        borderRadius: 11,
        background: 'var(--bg2)',
        padding: 'var(--s3) var(--s4)',
      }}
    >
      <SearchIcon />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('');
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Search trash"
        aria-label="Search trash"
        style={{
          flex: 1,
          minWidth: 0,
          border: 0,
          background: 'none',
          outline: 'none',
          font: 'inherit',
          fontSize: '0.92rem',
          color: 'var(--ink)',
          padding: 0,
        }}
      />
    </div>
  );
}

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
 * The Trash body's loading/error/empty/results branches (Trash search slice)
 * — pulled out of `TrashView` itself so that component's own complexity stays
 * under the lint gate once search added a second (loading, empty, results)
 * triple alongside the browse feed's. `isError` only ever reflects the browse
 * feed's `useTrashList` query — a failed SEARCH request instead lands on
 * `shownLinks.length === 0` and reads as "nothing found" rather than a load
 * error, since `useSearchTrash` has no dedicated error copy of its own here
 * (mirrors the Library's search, which also has no separate search-error
 * state — see `useListView`'s doc comment).
 */
function TrashBody({
  loading,
  isError,
  searchEnabled,
  query,
  shownLinks,
  purgeWindowDays,
}: {
  loading: boolean;
  isError: boolean;
  searchEnabled: boolean;
  query: string;
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

  if (!searchEnabled && isError) {
    return (
      <p style={{ padding: '40px 11px', margin: 0, fontSize: '0.82rem', color: 'var(--warn)' }}>
        Couldn't load the trash.
      </p>
    );
  }

  if (shownLinks.length === 0) {
    return searchEnabled ? (
      <NoSearchResults q={query} />
    ) : (
      <TrashEmptyState purgeWindowDays={purgeWindowDays} />
    );
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
 * `/trash` (plan 011, V3-5; server-side search added by the Trash search
 * slice) — day-grouped trash rows with a purge countdown, per-row
 * restore/delete-now, and the bottom docks (idle "select all · empty all" /
 * selection "restore · delete now · clear"). The per-row restore/delete-now
 * mutations (`useRestoreLink`/`useDeleteNow`) live in `TrashRowActions`
 * (`TrashRow.tsx`), not here — this component only owns the feed/search
 * orchestration, the day-grouping, and the two bulk docks (rendering itself
 * delegated to `TrashBody`, kept in this file for its complexity budget).
 */
export function TrashView() {
  const { data: counts } = useCounts();
  const { data, isLoading, isError } = useTrashList();
  const selection = useTrashSelection();

  // Server-side search (Trash search slice) — mirrors the Library's
  // omnibar/`useListView` split exactly: `query` is the raw, every-keystroke
  // value always shown in the input; `debouncedQuery` is what's actually
  // handed to `useSearchTrash`, so typing doesn't fire a request per
  // keystroke. `searchEnabled` gates which feed renders — a non-empty
  // debounced query switches the body to search results (day-grouped by
  // `deletedAt`, same as the plain feed); clearing it falls back to the
  // normal `listTrash` browse feed.
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, TRASH_SEARCH_DEBOUNCE_MS);
  const searchEnabled = debouncedQuery.trim().length > 0;
  const { data: searchData, isLoading: isSearching } = useSearchTrash(
    searchEnabled ? debouncedQuery : '',
  );

  const links = data?.links ?? [];
  const searchResults: TrashSearchResultJson[] = searchData?.results ?? [];
  const purgeWindowDays = counts?.purgeWindowDays ?? 30;
  const selectedIds = selection.selected;
  const hasSelection = selectedIds.length > 0;

  // Escape is handled centrally by `AppFrame`'s `RowMenuLayer` (closes the
  // row `⋯` menu first if one is open, otherwise clears this scope's
  // selection) — see that component's doc comment. No listener needed here.

  const shownLinks = searchEnabled ? searchResults : links;
  const loading = searchEnabled ? isSearching : isLoading;

  return (
    <>
      <ContentHeader title="Trash" count={links.length}>
        <TrashSearchInput value={query} onChange={setQuery} />
      </ContentHeader>
      <div className="silo-content-body">
        <div className="silo-content-col silo-route-fade">
          <TrashBody
            loading={loading}
            isError={isError}
            searchEnabled={searchEnabled}
            query={debouncedQuery}
            shownLinks={shownLinks}
            purgeWindowDays={purgeWindowDays}
          />
        </div>
      </div>

      {hasSelection && <TrashSelectionDock selectedIds={selectedIds} />}
      {!hasSelection && !searchEnabled && links.length > 0 && (
        <TrashIdleDock purgeWindowDays={purgeWindowDays} allIds={links.map((l) => l.id)} />
      )}
    </>
  );
}
