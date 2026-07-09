import type { ReactNode } from 'react';
import type { LinkJson } from '../../api/types';
import { DayGroup } from '../../components/DayGroup';
import { bucketByDay } from '../../lib/buckets';
import { useIntersectionPrefetch } from '../../lib/useIntersectionPrefetch';
import { ErrorState, LoadingState } from './ListStates';
import type { ListViewState } from './useListView';

/**
 * The normal (non-search) list body: day-grouped rows, the prefetch
 * sentinel, and the "load more" affordance — shared by `LibraryView` (no tag
 * filter) and `TagView` (`useInfiniteLinks(tag)`'s feed). `emptyState` is
 * caller-supplied so each view's empty-state copy stays view-specific while
 * the pagination chrome doesn't get duplicated.
 */
function LinkListBody({
  links,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  emptyState,
}: {
  links: LinkJson[];
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  emptyState: ReactNode;
}) {
  const canPrefetch = Boolean(hasNextPage) && !isFetchingNextPage;
  const sentinelRef = useIntersectionPrefetch(fetchNextPage, { enabled: canPrefetch });

  if (links.length === 0) return <>{emptyState}</>;

  const groups = bucketByDay(links);
  return (
    <div style={{ flex: 1 }}>
      {groups.map((group) => (
        <DayGroup key={group.label} label={group.label} links={group.items} />
      ))}

      {/* Prefetch sentinel — sits just above the foot so the observer fires before the user reaches the button. Renders nothing visible. */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

      {hasNextPage && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <button
            type="button"
            onClick={fetchNextPage}
            disabled={isFetchingNextPage}
            style={{
              border: '1px solid var(--line)',
              background: 'var(--bg2)',
              color: 'var(--ink)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 'var(--text-base)',
              fontFamily: 'inherit',
              cursor: isFetchingNextPage ? 'default' : 'pointer',
              opacity: isFetchingNextPage ? 0.6 : 1,
            }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The full body-branch selection shared by `LibraryView`/`TagView` (plan 011,
 * V3-2; simplified plan 024 — search moved entirely to the command palette,
 * so this is now just loading → error → the day-grouped browse feed). Takes
 * the orchestration state from `useListView` plus the view-specific
 * `emptyState`, so neither route duplicates the branch logic.
 */
export function ListBody(state: ListViewState, emptyState: ReactNode): ReactNode {
  if (state.isLoading) return <LoadingState />;
  if (state.isError && state.error) return <ErrorState error={state.error} />;
  return (
    <LinkListBody
      links={state.links}
      hasNextPage={state.hasNextPage}
      isFetchingNextPage={state.isFetchingNextPage}
      fetchNextPage={state.fetchNextPage}
      emptyState={emptyState}
    />
  );
}
