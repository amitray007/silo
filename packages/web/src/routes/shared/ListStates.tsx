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

/**
 * Per-row title-line widths for the skeleton feed below, grouped into two
 * day-clusters (mirrors `bucketByDay`'s real output shape) — varied widths
 * (not a uniform 60%) so the placeholder rows don't read as a mechanical
 * striped pattern before real titles land.
 */
const SKELETON_GROUPS: string[][] = [
  ['60%', '45%', '70%'],
  ['52%', '38%'],
];

/**
 * One placeholder day-heading, shaped exactly like a real `DayGroupHeading`
 * (`--text-sm` ≈ 12.8px line, `padding: var(--s3) var(--s2-5) var(--s1-5)
 * var(--s2-5)` = 12px 10px 6px 10px, no margin) — same box, so the skeleton
 * heading occupies the identical footprint the real "Today"/"Yesterday"/
 * month label will land in.
 */
function SkeletonDayHeading() {
  return (
    <div style={{ padding: 'var(--s3) var(--s2-5) var(--s1-5) var(--s2-5)' }}>
      <Skeleton height={13} width={64} radius={4} />
    </div>
  );
}

/**
 * One placeholder row shaped exactly like a real `.silo-link-row`
 * (`LinkRow.tsx`) — same outer padding (`var(--s2-5)` = 10px, matching the
 * `.silo-link-row` CSS rule in base.css) and the same inner flex anatomy
 * (`gap: var(--s3)` = 12px, an 18×18 radius-4 favicon chip, then a title
 * line), so swapping this for the real row produces no layout shift in row
 * height or horizontal alignment — no `role`/`aria-hidden` here, the
 * shimmer blocks are already `aria-hidden` and the loading announcement
 * lives once on the outer container below.
 */
function SkeletonRow({ titleWidth }: { titleWidth: string }) {
  const rowStyle = {
    padding: 'var(--s2-5)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--s3)',
  };
  return (
    <div style={rowStyle}>
      <Skeleton width={18} height={18} radius={4} />
      <Skeleton height={14} width={titleWidth} radius={4} />
    </div>
  );
}

/**
 * The calm first-page loading placeholder — shimmering day-groups shaped
 * like the real `DayGroup`s they'll be replaced by (fix, direct user
 * feedback: the old flat `height:34` blocks with `padding:'20px 11px'`
 * matched neither the real rows' `10px` inset/anatomy NOR the day-heading
 * chrome above them, so the feed visibly jumped — both horizontally and
 * vertically — once data landed). Two heading+rows clusters (mirroring
 * `DayGroup.tsx`'s own heading-then-rows shell) with 5 rows total — enough
 * to fill a first viewport, like a real first page. Shared by `LibraryView`
 * and `TagView`.
 */
export function LoadingState() {
  return (
    <div role="status" aria-label="Loading…">
      {SKELETON_GROUPS.map((rowWidths, groupIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a static, never-reordered placeholder list
        <div key={groupIndex}>
          <SkeletonDayHeading />
          {rowWidths.map((width, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a static, never-reordered placeholder list
            <SkeletonRow key={rowIndex} titleWidth={width} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The design's richer empty state (`Silo-v2.html:96-103`) — the Stack mark + a caller-supplied headline/body, so `LibraryView`'s "Nothing kept yet." and `TagView`'s "No links tagged #x yet." share one shell. */
export function EmptyState({ title, body }: { title: string; body: ReactNode }) {
  return (
    <CenteredPanel>
      {/* The PLATED brand mark (not the bare bars): the tile gives the mark a
          container so it reads as an intentional logo anchoring the empty
          pane, rather than a stray glyph floating in a large dark card (direct
          user feedback that the small bare mark "looked bad"). Sized up to 40
          so it holds the composition. */}
      <GrainDot size={40} plate />
      <p
        style={{
          margin: '18px 0 0',
          fontSize: 'var(--text-lg)',
          fontWeight: 500,
          color: 'var(--ink)',
          letterSpacing: 'var(--tracking-tight)',
          textWrap: 'balance',
        }}
      >
        {title}
      </p>
      <div
        style={{
          margin: '8px 0 0',
          fontSize: 'var(--text-base)',
          color: 'var(--mut)',
          maxWidth: '24rem',
          lineHeight: 1.55,
          textWrap: 'pretty',
        }}
      >
        {body}
      </div>
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
