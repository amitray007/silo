import type { ReactNode } from 'react';
import type { ApiError } from '../../api/client';
import { CenteredPanel } from '../../components/CenteredPanel';
import { GrainDot } from '../../components/GrainDot';

/**
 * Render-state components shared by every list view that pairs an omnibar
 * with a day-grouped body (`LibraryView`, `TagView` — plan 011, V3-2). Pulled
 * out once both views needed the identical loading/empty/error/no-results
 * chrome, so the two views differ only in their DATA SOURCE (`useInfiniteLinks()`
 * vs `useInfiniteLinks(tag)`) and their empty-state COPY, not in markup that
 * would otherwise be copy-pasted between two route files (and trip jscpd).
 */

/** The calm first-page loading placeholder — a couple of muted skeleton rows, not a spinner (CLAUDE.md "calm" states). */
export function LoadingState() {
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

/** The design's richer empty state (`Silo-v2.html:96-103`) — the grain-dot + a caller-supplied headline/body, so `LibraryView`'s "Nothing kept yet." and `TagView`'s "No links tagged #x yet." share one shell. */
export function EmptyState({ title, body }: { title: string; body: ReactNode }) {
  return (
    <CenteredPanel>
      <GrainDot size={22} />
      <p style={{ margin: '22px 0 0', fontSize: '0.92rem', fontWeight: 500, color: 'var(--ink)' }}>
        {title}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--mut)', maxWidth: '24rem' }}>
        {body}
      </p>
    </CenteredPanel>
  );
}

/** v3's `noResults` state (`Silo-v3.html:171-173`) — a plain left-aligned line, not the full centered empty-state treatment (that's reserved for "nothing here at all"). */
export function NoSearchResults({ q }: { q: string }) {
  return (
    <p style={{ padding: '40px 11px', margin: 0, fontSize: '0.82rem', color: 'var(--fnt)' }}>
      nothing found for "{q}"
    </p>
  );
}

/** A calm inline error message (not a white screen — the `ErrorBoundary` still backstops render errors). */
export function ErrorState({ error }: { error: ApiError }) {
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
