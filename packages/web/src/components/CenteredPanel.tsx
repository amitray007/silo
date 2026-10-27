import type { ReactNode } from 'react';

/**
 * The shared calm centered-column layout behind every content-pane state
 * that isn't a populated list: `ComingSoon`, the Library's empty/error
 * states, and `ErrorBoundary`'s fallback all want the same centered,
 * chrome-free column (`Silo-v2.html:96-103`) — pulled out once so the
 * padding/alignment doesn't drift between them.
 */
export function CenteredPanel({
  children,
  empty = false,
}: {
  children: ReactNode;
  empty?: boolean;
}) {
  // An empty list state also centers vertically in the pane (see `.silo-empty-state`).
  return (
    <div className={empty ? 'silo-centered-panel silo-empty-state' : 'silo-centered-panel'}>
      {children}
    </div>
  );
}
