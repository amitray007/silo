import type { ReactNode } from 'react';

/**
 * A small sidebar section heading (e.g. "Tags") + its children. Matches the
 * prototype's `.7rem` ghost, letter-spaced label (docs/design/app/Silo-v2.html).
 */
export function SidebarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '18px 10px 5px' }}>
        <p
          style={{
            fontSize: '0.7rem',
            fontWeight: 500,
            color: 'var(--ghost)',
            margin: 0,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}
