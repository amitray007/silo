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
    const place = () => {
      const row = anchor.getBoundingClientRect();
      const box = ref.current?.getBoundingClientRect();
      const height = box?.height ?? 0;
      const width = box?.width ?? 216;
      setPosition({
        left: Math.max(8, Math.min(row.right - width, innerWidth - width - 8)),
        top: Math.max(8, Math.min(row.bottom + 4, innerHeight - height - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
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
