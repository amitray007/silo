import { type RefObject, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { scrollDirection } from './scrollDirection';

/** Keep the header steady through jitter, overscroll, and content changes. */
export function useHideOnScroll(
  scrollRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string | null,
) {
  const [hidden, setHidden] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new article/tab resets direction and visibility.
  useEffect(() => {
    setHidden(false);
    const scroller = scrollRef.current;
    if (!enabled || !scroller) return;
    const direction = scrollDirection(scroller.scrollTop);
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = direction.update(
        scroller.scrollTop,
        scroller.scrollHeight - scroller.clientHeight,
      );
      if (next !== undefined) setHidden(next);
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      direction.sync(scroller.scrollTop);
      // Reveal before the browser chooses the next focus target, including Shift+Tab.
      flushSync(() => setHidden(false));
    };
    scroller.addEventListener('scroll', scroll, { passive: true });
    document.addEventListener('keydown', keyboard, true);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', scroll);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, [scrollRef, enabled, resetKey]);

  return enabled && hidden;
}
