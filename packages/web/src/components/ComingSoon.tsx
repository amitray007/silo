import { CenteredPanel } from './CenteredPanel';

/**
 * The calm content-area placeholder for routed views not yet built (W5).
 * Matches the prototype's empty-state calm: centered, muted, no chrome.
 */
export function ComingSoon({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <CenteredPanel>
      <p
        style={{
          margin: 0,
          fontSize: 'var(--text-md)',
          fontWeight: 500,
          color: 'var(--ink)',
          letterSpacing: 'var(--tracking-tight)',
          textWrap: 'balance',
        }}
      >
        {title}
      </p>
      {subtitle && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 'var(--text-base)',
            color: 'var(--mut)',
            maxWidth: '24rem',
            textWrap: 'pretty',
          }}
        >
          {subtitle}
        </p>
      )}
    </CenteredPanel>
  );
}
