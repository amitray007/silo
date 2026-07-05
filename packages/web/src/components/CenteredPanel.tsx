import type { ReactNode } from 'react';

/**
 * The shared calm centered-column layout behind every content-pane state
 * that isn't a populated list: `ComingSoon`, the Library's empty/error
 * states, and `ErrorBoundary`'s fallback all want the same centered,
 * chrome-free column (`Silo-v2.html:96-103`) — pulled out once so the
 * padding/alignment doesn't drift between them.
 */
export function CenteredPanel({ children }: { children: ReactNode }) {
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
      {children}
    </div>
  );
}
