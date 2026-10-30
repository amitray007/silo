import { useEffect, useState } from 'react';
import { navItemRowStyle } from './NavItem';
import { ReaderIcon } from './reader/ReaderIcon';
import { Skeleton } from './Skeleton';

const LABEL_WIDTHS = ['62%', '78%', '48%', '70%', '56%'];
const blockStyle = { animation: 'none', background: 'var(--line)' };

function SidebarRowSkeleton({ kind, width }: { kind: 'feeds' | 'tags'; width: string }) {
  return (
    <div className="silo-nav-item silo-sidebar-row-skeleton" style={navItemRowStyle}>
      <span className="silo-nav-icon" style={{ color: 'var(--line)' }}>
        {kind === 'feeds' ? (
          <Skeleton width={16} height={16} radius={4} style={blockStyle} />
        ) : (
          <ReaderIcon name="hash" />
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <Skeleton width={width} height={9} radius={3} style={blockStyle} />
      </span>
      <Skeleton width={14} height={8} radius={3} style={blockStyle} />
    </div>
  );
}

/** Mount only during initial loading. Reserve the row space before revealing it. */
export function SidebarRowSkeletonList({ kind }: { kind: 'feeds' | 'tags' }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="silo-sidebar-skeleton-list" aria-hidden="true" data-visible={visible}>
      {LABEL_WIDTHS.slice(0, kind === 'feeds' ? 3 : 5).map((width) => (
        <SidebarRowSkeleton key={width} kind={kind} width={width} />
      ))}
    </div>
  );
}
