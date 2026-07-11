import type { ReactNode } from 'react';
import type { ApiError } from '../../api/client';
import { CenteredPanel } from '../../components/CenteredPanel';
import { GrainDot } from '../../components/GrainDot';
import { Skeleton } from '../../components/Skeleton';

/**
 * Render-state components shared by every list view that pairs an omnibar
 * with a day-grouped body (`LibraryView`, `TagView` — plan 011, V3-2). Pulled
 * out once both views needed the identical loading/empty/error/no-results
 * chrome, so the two views differ only in their DATA SOURCE (`useInfiniteLinks()`
 * vs `useInfiniteLinks(tag)`) and their empty-state COPY, not in markup that
 * would otherwise be copy-pasted between two route files (and trip jscpd).
 */

/** The calm first-page loading placeholder — a few shimmering skeleton rows, not a spinner (CLAUDE.md "calm" states). Shared by `LibraryView` and `TagView`. */
export function LoadingState() {
  return (
    <div style={{ padding: '20px 11px' }} role="status" aria-label="Loading…">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={34} radius={8} style={{ marginBottom: 8 }} />
      ))}
    </div>
  );
}

/** The design's richer empty state (`Silo-v2.html:96-103`) — the Stack mark + a caller-supplied headline/body, so `LibraryView`'s "Nothing kept yet." and `TagView`'s "No links tagged #x yet." share one shell. */
export function EmptyState({ title, body }: { title: string; body: ReactNode }) {
  return (
    <CenteredPanel>
      <GrainDot size={22} />
      <p
        style={{
          margin: '22px 0 0',
          fontSize: 'var(--text-md)',
          fontWeight: 500,
          color: 'var(--ink)',
          letterSpacing: 'var(--tracking-tight)',
          textWrap: 'balance',
        }}
      >
        {title}
      </p>
      <p
        style={{
          margin: '6px 0 0',
          fontSize: 'var(--text-base)',
          color: 'var(--mut)',
          maxWidth: '24rem',
          textWrap: 'pretty',
        }}
      >
        {body}
      </p>
    </CenteredPanel>
  );
}

/** A calm inline error message (not a white screen — the `ErrorBoundary` still backstops render errors). */
export function ErrorState({ error }: { error: ApiError }) {
  return (
    <CenteredPanel>
      <p
        style={{
          margin: 0,
          fontSize: 'var(--text-md)',
          fontWeight: 500,
          color: 'var(--warn)',
          letterSpacing: 'var(--tracking-tight)',
          textWrap: 'balance',
        }}
      >
        Couldn't load your links.
      </p>
      <p
        style={{
          margin: '6px 0 0',
          fontSize: 'var(--text-base)',
          color: 'var(--mut)',
          maxWidth: '24rem',
          textWrap: 'pretty',
        }}
      >
        {error.message}
      </p>
    </CenteredPanel>
  );
}
