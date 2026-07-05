import type { ReactNode } from 'react';

interface ContentHeaderProps {
  /** The view title (e.g. "Library", "Trash", "#tagname", "Settings"). */
  title: ReactNode;
  /** A ghost-colored count/meta next to the title (e.g. the live link count). Omitted when there's nothing to show. */
  count?: ReactNode;
  /**
   * The `◌ {enriching}` indicator (plan 011, V3-3) — rendered left of the
   * omnibar slot, exactly matching v3's `enrichBusy` block position
   * (`Silo-v3.html` lines 71-75). Pass a positive count to show it; `0` or
   * `undefined` renders nothing (no chrome for a quiet feed).
   */
  enrichingCount?: number;
  /**
   * A capture failure's message (plan 011, V3-3) — the omnibar clears
   * optimistically on every `keep ↵`, so a failed capture MUST surface
   * somewhere or it's invisible; this is that one calm line, in `--warn`
   * (the same token the row-level `degraded` mark uses), left of the
   * enriching indicator. `undefined` renders nothing.
   */
  captureError?: string;
  /** Right-aligned slot — reserved for the omnibar (V3-2); pass nothing to render an empty placeholder sized to match. */
  children?: ReactNode;
}

/**
 * The v3 content header bar (`docs/design/app/Silo-v3.html`): a full-width row
 * above the scrolling body — view title + count on the left, a `flex:1`
 * spacer, the enriching indicator (V3-3), then a right-aligned slot sized for
 * the omnibar.
 */
export function ContentHeader({
  title,
  count,
  enrichingCount,
  captureError,
  children,
}: ContentHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '14px clamp(16px, 3vw, 28px)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <span
        style={{
          fontSize: '1rem',
          fontWeight: 500,
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {count !== undefined && (
        <span style={{ fontSize: '0.76rem', color: 'var(--ghost)' }}>{count}</span>
      )}
      <span style={{ flex: 1 }} />
      {captureError && (
        <span
          role="alert"
          style={{
            flex: 'none',
            fontSize: '0.76rem',
            color: 'var(--warn)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '16rem',
          }}
        >
          couldn't save that — {captureError}
        </span>
      )}
      {Boolean(enrichingCount) && (
        <span
          title="capture continues in the background — you can leave"
          style={{
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: '0.76rem',
            color: 'var(--fnt)',
          }}
        >
          <span
            style={{
              color: 'var(--markt)',
              fontSize: '0.85rem',
              animation: 'siloPulse 1.6s ease-in-out infinite',
            }}
          >
            ◌
          </span>
          <span>{enrichingCount} capturing</span>
        </span>
      )}
      {children ?? (
        <div
          aria-hidden="true"
          style={{
            width: 'clamp(230px, 42%, 430px)',
            height: 32,
            borderRadius: 10,
            background: 'var(--bg2)',
          }}
        />
      )}
    </div>
  );
}
