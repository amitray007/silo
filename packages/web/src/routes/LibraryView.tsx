import type { ApiError } from '../api/client';
import { useInfiniteLinks } from '../api/hooks';
import { CenteredPanel } from '../components/CenteredPanel';
import { DayGroup } from '../components/DayGroup';
import { GrainDot } from '../components/GrainDot';
import { bucketByDay } from '../lib/buckets';
import { useIntersectionPrefetch } from '../lib/useIntersectionPrefetch';

/** The calm first-page loading placeholder — a couple of muted skeleton rows, not a spinner (CLAUDE.md "calm" states). */
function LoadingState() {
  return (
    <div style={{ padding: '20px 11px' }} role="status" aria-label="Loading…">
      {[0, 1, 2].map((i) => (
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

/** The design's richer empty state (`Silo-v2.html:96-103`) — the grain-dot + "Nothing kept yet." */
function EmptyState() {
  return (
    <CenteredPanel>
      <GrainDot size={22} />
      <p style={{ margin: '22px 0 0', fontSize: '0.92rem', fontWeight: 500, color: 'var(--ink)' }}>
        Nothing kept yet.
      </p>
      <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--mut)', maxWidth: '24rem' }}>
        Paste a link in the bar above — it's saved the moment it lands.
      </p>
      <p
        style={{ margin: '26px 0 0', fontSize: '0.76rem', color: 'var(--fnt)', maxWidth: '24rem' }}
      >
        Claude can add links here too, once you connect it in Settings → access.
      </p>
    </CenteredPanel>
  );
}

/** A calm inline error message (not a white screen — the `ErrorBoundary` still backstops render errors). */
function ErrorState({ error }: { error: ApiError }) {
  return (
    <CenteredPanel>
      <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 500, color: 'var(--warn)' }}>
        Couldn't load your links
      </p>
      <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--mut)', maxWidth: '24rem' }}>
        {error.message}
      </p>
    </CenteredPanel>
  );
}

/**
 * `/` — the Library list (plan 010): day-grouped, read-only rows fed by
 * `useInfiniteLinks`. Pagination is a visible "load more" button (the
 * deterministic, a11y-friendly affordance) backed by an `IntersectionObserver`
 * sentinel that eagerly prefetches the next page as the user nears the foot,
 * so the button (or the next scroll) usually hits a warm cache.
 */
export function LibraryView() {
  const { data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteLinks();

  const canPrefetch = Boolean(hasNextPage) && !isFetchingNextPage;
  const sentinelRef = useIntersectionPrefetch(() => fetchNextPage(), { enabled: canPrefetch });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState error={error as ApiError} />;

  const links = data?.pages.flatMap((page) => page.links) ?? [];
  if (links.length === 0) return <EmptyState />;

  const groups = bucketByDay(links);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 20px' }}>
      {groups.map((group) => (
        <DayGroup key={group.label} label={group.label} links={group.items} />
      ))}

      {/* Prefetch sentinel — sits just above the foot so the observer fires before the user reaches the button. Renders nothing visible. */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

      {hasNextPage && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            style={{
              border: '1px solid var(--line)',
              background: 'var(--bg2)',
              color: 'var(--ink)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: '0.84rem',
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
