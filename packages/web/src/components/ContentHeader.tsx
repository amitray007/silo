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
    <header className="silo-panehead">
      <h1>{title}</h1>
      {count !== undefined && <span className="silo-pane-count">{count}</span>}
      <span className="silo-pane-spacer" />
      {captureError && (
        <span role="alert" className="silo-pane-error">
          Couldn't save that - {captureError}
        </span>
      )}
      {children}
    </header>
  );
}
