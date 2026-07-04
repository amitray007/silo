/**
 * The calm content-area placeholder for routed views not yet built (W5).
 * Matches the prototype's empty-state calm: centered, muted, no chrome.
 */
export function ComingSoon({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '104px 0 40px',
        textAlign: 'center',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 500, color: 'var(--ink)' }}>
        {title}
      </p>
      {subtitle && (
        <p
          style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--mut)', maxWidth: '24rem' }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
