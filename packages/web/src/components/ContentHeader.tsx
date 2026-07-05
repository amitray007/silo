import type { ReactNode } from 'react';

interface ContentHeaderProps {
  /** The view title (e.g. "Library", "Trash", "#tagname", "Settings"). */
  title: ReactNode;
  /** A ghost-colored count/meta next to the title (e.g. the live link count). Omitted when there's nothing to show. */
  count?: ReactNode;
  /** Right-aligned slot — reserved for the omnibar (V3-2); pass nothing to render an empty placeholder sized to match. */
  children?: ReactNode;
}

/**
 * The v3 content header bar (`docs/design/app/Silo-v3.html`): a full-width row
 * above the scrolling body — view title + count on the left, a `flex:1`
 * spacer, then a right-aligned slot sized for the omnibar. The omnibar itself
 * lands in V3-2; this slice reserves its position/size so the header reads
 * correctly (an empty `--bg2` placeholder pill at the omnibar's exact width).
 */
export function ContentHeader({ title, count, children }: ContentHeaderProps) {
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
