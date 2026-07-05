import type { ReactNode } from 'react';

interface ContentHeaderProps {
  /** The view title (e.g. "Library", "Trash", "#tagname", "Settings"). */
  title: ReactNode;
  /** A ghost-colored count/meta next to the title (e.g. the live link count). Omitted when there's nothing to show. */
  count?: ReactNode;
  /**
   * A capture failure's message (plan 011, V3-3) — the omnibar clears
   * optimistically on every `keep ↵`, so a failed capture MUST surface
   * somewhere or it's invisible; this is that one calm line, in `--warn`.
   * `undefined` renders nothing.
   */
  captureError?: string;
  /** Right-aligned slot — reserved for the omnibar (V3-2); pass nothing to render an empty placeholder sized to match. */
  children?: ReactNode;
}

/**
 * The v3 content header bar (`docs/design/app/Silo-v3.html`): a full-width row
 * above the scrolling body — view title + count on the left, a `flex:1`
 * spacer, then a right-aligned slot sized for the omnibar.
 *
 * The `◌ {enriching}` indicator (v3's `enrichBusy` block) is REMOVED per a
 * direct user-feedback polish pass — no capturing UI anywhere in the app
 * (`enrichingCount` is no longer a prop; callers just stop passing it).
 */
export function ContentHeader({ title, count, captureError, children }: ContentHeaderProps) {
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
      {children ?? (
        <div
          aria-hidden="true"
          style={{
            width: 'clamp(280px, 46%, 520px)',
            height: 40,
            borderRadius: 10,
            background: 'var(--bg2)',
          }}
        />
      )}
    </div>
  );
}
