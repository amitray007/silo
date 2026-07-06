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
  /** Right-aligned slot — reserved for the omnibar (V3-2). Renders nothing when omitted (TrashView/SettingsView pass no children — a phantom placeholder box there would be decorative chrome that does nothing, violating "silence means complete"). */
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
      {/* The one real heading per route (Library/Trash/#tag) — previously a
          plain <span>, so a screen-reader user navigating by heading found
          NOTHING anywhere in the app (Rams review: heading hierarchy). `h1`
          is correct here (not `h2`+): each route only ever renders one
          `ContentHeader`, and it's the top-level heading for that screen's
          content — the sidebar/nav chrome around it has no headings of its
          own to nest under. Margin reset to 0 since a bare `<h1>` carries
          browser default block margins that would shift this row's layout. */}
      <h1
        style={{
          margin: 0,
          // Indent the title to the FAVICON column so "Library"/"Trash"/"#tag"
          // sits on the same left line as the row favicons + the "Today" day
          // label below it (user feedback: align the header to where the
          // favicons/data start). That column = the row's own left padding
          // (--s2-5) in from the content edge; the header shares the content
          // edge, so --s2-5 lands the title exactly above the favicons. The
          // border-bottom still spans full width — only the text moves.
          marginLeft: 'var(--s2-5)',
          fontSize: '1rem',
          fontWeight: 500,
          color: 'var(--ink)',
          // The route title stays on one line (Library / Trash / #tag are
          // short); `textWrap: 'balance'` was dropped as inert under
          // `whiteSpace: 'nowrap'` (review fix).
          whiteSpace: 'nowrap',
          letterSpacing: 'var(--tracking-tight)',
          lineHeight: 'var(--lh-tight)',
        }}
      >
        {title}
      </h1>
      {count !== undefined && (
        <span style={{ fontSize: '0.76rem', color: 'var(--fnt)' }}>{count}</span>
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
          Couldn't save that — {captureError}
        </span>
      )}
      {children}
    </div>
  );
}
