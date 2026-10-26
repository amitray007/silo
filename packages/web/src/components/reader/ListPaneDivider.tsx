import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  MAX_LIST_WIDTH,
  MIN_LIST_WIDTH,
  resetListWidth,
  setListWidth,
} from '../../lib/useListWidth';

/** The reader keeps 420px (layout.css), so a narrow window caps the list below 720px. */
function widestList(handle: HTMLElement) {
  const room = (handle.parentElement?.getBoundingClientRect().width ?? 0) - 420;
  return Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, room));
}

export function ListPaneDivider({ width, fullWindow }: { width: number; fullWindow: boolean }) {
  return fullWindow ? null : <DesktopDivider width={width} />;
}

function DesktopDivider({ width }: { width: number }) {
  const drag = useRef<{ pointerId: number; left: number; handle: HTMLDivElement } | null>(null);
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const [widest, setWidest] = useState(MAX_LIST_WIDTH);
  // Track the room beside the reader so ARIA reports the width the list actually shows.
  useLayoutEffect(() => {
    const handle = handleRef.current;
    const pane = handle?.parentElement;
    if (!handle || !pane) return;
    const measure = () => setWidest(widestList(handle));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  const shown = Math.min(width, widest);
  const stopDragging = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    document.documentElement.classList.remove('silo-list-resizing');
    if (active.handle.hasPointerCapture(active.pointerId))
      active.handle.releasePointerCapture(active.pointerId);
    setDragging(false);
  }, []);
  useEffect(() => stopDragging, [stopDragging]);

  function startDragging(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return;
    const handle = event.currentTarget;
    const list = handle.previousElementSibling;
    if (!list) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, left: list.getBoundingClientRect().left, handle };
    document.documentElement.classList.add('silo-list-resizing');
    setDragging(true);
  }

  function moveDivider(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    setListWidth(Math.min(event.clientX - drag.current.left, widestList(drag.current.handle)));
  }

  function finishDragging(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) stopDragging();
  }

  function resizeWithKey(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.shiftKey ? 64 : 16;
    const room = widestList(event.currentTarget);
    const current = Math.min(width, room);
    const widths: Record<string, number> = {
      ArrowLeft: current - step,
      ArrowRight: Math.min(current + step, room),
      Home: MIN_LIST_WIDTH,
      End: room,
    };
    const next = widths[event.key];
    if (event.key === 'Enter') {
      event.preventDefault();
      resetListWidth();
    } else if (next !== undefined) {
      event.preventDefault();
      setListWidth(next);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: This focusable separator resizes panes, rather than marking a thematic break.
    <div
      ref={handleRef}
      className="silo-list-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize link list"
      aria-valuemin={MIN_LIST_WIDTH}
      aria-valuemax={widest}
      aria-valuenow={shown}
      tabIndex={0}
      data-dragging={dragging}
      onPointerDown={startDragging}
      onPointerMove={moveDivider}
      onPointerUp={finishDragging}
      onPointerCancel={finishDragging}
      onLostPointerCapture={finishDragging}
      onKeyDown={resizeWithKey}
      onDoubleClick={resetListWidth}
    />
  );
}
