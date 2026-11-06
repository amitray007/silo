import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const EDGE = 8;
const GAP = 4;

/**
 * Menus escape the list's scroll clipping; the list still owns their state. `end` (default) lines
 * the menu's right edge up with the anchor's; `start` lines up the left edge and opens on the side
 * of the anchor with more room.
 */
export function RowPopover({
  anchor,
  align = 'end',
  children,
  onDismiss,
}: {
  anchor: HTMLElement | null;
  align?: 'start' | 'end';
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
      const edge = align === 'start' ? row.left : row.right - width;
      // A start-aligned menu opens toward the larger space, so one under the last chat answer
      // rises over the thread instead of covering the composer.
      const flip = align === 'start' && row.top > innerHeight - row.bottom;
      setPosition({
        left: Math.max(EDGE, Math.min(edge, innerWidth - width - EDGE)),
        top: flip
          ? Math.max(EDGE, row.top - GAP - height)
          : Math.max(EDGE, Math.min(row.bottom + GAP, innerHeight - height - EDGE)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [anchor, align]);
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
      data-flyout-side={position && position.left < 232 ? 'right' : 'left'}
      style={{
        position: 'fixed',
        zIndex: 36,
        ...position,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
