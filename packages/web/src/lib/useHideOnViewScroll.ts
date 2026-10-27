import { type RefObject, useEffect, useRef, useState } from 'react';
import { scrollDirection } from './scrollDirection';

/** Hiding resizes the frame, and the copy may clamp its scroll in response. */
const SETTLE_MS = 300;

type ViewScroll = { type: 'silo:view-scroll'; top: number; max: number; scroller: number };

function isViewScroll(data: unknown): data is ViewScroll {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Partial<ViewScroll>;
  return (
    message.type === 'silo:view-scroll' &&
    Number.isFinite(message.top) &&
    Number.isFinite(message.max) &&
    Number.isFinite(message.scroller)
  );
}

/**
 * Live's Silo view copy reports its scroll with a hash-pinned script, so the
 * header hides and returns on the same distances as Reader. Messages count
 * only when they come from the frame inside this panel.
 */
export function useHideOnViewScroll(
  panelRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string | null,
) {
  // Keyed so a hide for the last article never renders for the next one.
  const [hidden, setHidden] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  const hiddenRef = useRef(false);
  enabledRef.current = enabled;

  // A paused header (menu, focus, hover) comes back shown, as in Reader.
  useEffect(() => {
    if (enabled) return;
    hiddenRef.current = false;
    setHidden(null);
  }, [enabled]);

  useEffect(() => {
    hiddenRef.current = false;
    setHidden(null);
    const direction = scrollDirection();
    let settleUntil = 0;
    let scroller = 0;
    const message = (event: MessageEvent) => {
      const frame = panelRef.current?.querySelector('iframe');
      if (!frame || event.source !== frame.contentWindow || !isViewScroll(event.data)) return;
      const { top, max } = event.data;
      // A new scroller starts its own baseline instead of reading as a jump.
      const switched = event.data.scroller !== scroller;
      scroller = event.data.scroller;
      if (switched || !enabledRef.current || performance.now() < settleUntil) {
        direction.sync(top, max);
        return;
      }
      const next = direction.update(top, max);
      if (next === undefined || next === hiddenRef.current) return;
      hiddenRef.current = next;
      settleUntil = performance.now() + SETTLE_MS;
      setHidden(next ? resetKey : null);
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [panelRef, resetKey]);

  return enabled && hidden !== null && hidden === resetKey;
}
