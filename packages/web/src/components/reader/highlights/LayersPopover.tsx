import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import type { ResolvedHighlight } from './useHighlightLayer';

/** The popover is 300px wide; keep 8px from the viewport edge. */
const WIDTH = 300;
const EDGE = 8;
const ROW = 52;

/**
 * Every highlight under a click, innermost first. Hovering or focusing a row isolates that
 * highlight's passage; Enter opens its note. Arrow keys move between rows; Escape closes.
 */
export function LayersPopover({
  items,
  at,
  container,
  onOpen,
  onClose,
  onHover,
}: {
  items: readonly ResolvedHighlight[];
  at: { x: number; y: number };
  container: HTMLElement;
  onOpen: (id: string) => void;
  onClose: () => void;
  onHover: (ids: string[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, onHover });
  latest.current = { onClose, onHover };
  useEscapeLayer(true, () => latest.current.onClose());

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      latest.current.onClose();
    };
    document.addEventListener('mousedown', outside);
    return () => {
      document.removeEventListener('mousedown', outside);
      latest.current.onHover([]);
    };
  }, []);

  const left = Math.min(Math.max(EDGE, at.x - 20), window.innerWidth - WIDTH - EDGE);
  const top = Math.min(at.y + 14, window.innerHeight - 40 - items.length * ROW);
  return createPortal(
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: arrow keys move between the rows inside.
    <div
      className="silo-layers"
      ref={box}
      role="dialog"
      aria-label="Layers"
      data-reader-menu
      style={{ left, top }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
        const rows = Array.from(box.current?.querySelectorAll<HTMLElement>('button') ?? []);
        const index = rows.indexOf(document.activeElement as HTMLElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        rows[(index + step + rows.length) % rows.length]?.focus();
      }}
    >
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-color={item.color}
              onMouseEnter={() => onHover([item.id])}
              onMouseLeave={() => onHover([])}
              onFocus={() => onHover([item.id])}
              onClick={() => onOpen(item.id)}
            >
              <span className="silo-layer-bar" />
              <span className="silo-layer-text">
                <span className="silo-layer-snippet">{item.highlight.quote}</span>
                {item.highlight.note && (
                  <span className="silo-layer-note silo-layer-note-ink">{item.highlight.note}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <footer title="Option-click cycles through the layers">{items.length} layers</footer>
    </div>,
    container,
  );
}
