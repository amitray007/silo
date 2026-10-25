import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Menus escape the list's scroll clipping; the list still owns their state. */
export function RowPopover({
  anchor,
  children,
  onDismiss,
}: {
  anchor: HTMLElement | null;
  children: ReactNode;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    if (!anchor) return;
    const row = anchor.getBoundingClientRect();
    const height = ref.current?.firstElementChild?.getBoundingClientRect().height ?? 0;
    const leftFloor = innerWidth >= 500 ? 240 : 8;
    setPosition({
      left: Math.max(leftFloor, Math.min(row.right - 232, innerWidth - 240)),
      top: Math.max(8, Math.min(row.bottom + 4, innerHeight - height - 8)),
    });
  }, [anchor]);
  useEffect(() => {
    if (!anchor) return;
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) onDismiss();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [anchor, onDismiss]);
  if (!anchor) return children;
  return createPortal(
    <div
      className="silo-row-menu-portal"
      ref={ref}
      style={{
        position: 'fixed',
        width: 232,
        zIndex: 36,
        visibility: position ? 'visible' : 'hidden',
        ...position,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
