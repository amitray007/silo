import { type RefObject, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

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
    let previous = scroller.scrollTop;
    let travel = 0;
    let frame = 0;
    const update = () => {
      frame = 0;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const top = Math.min(maximum, Math.max(0, scroller.scrollTop));
      const delta = top - previous;
      previous = top;
      if (top <= 48 || maximum === 0) {
        travel = 0;
        setHidden(false);
        return;
      }
      if (delta === 0) return;
      // Tiny reversals count toward net travel rather than restarting the run.
      travel =
        Math.sign(delta) === Math.sign(travel) || Math.abs(delta) <= 2 ? travel + delta : delta;
      if (Math.abs(travel) >= 8) {
        setHidden(travel > 0);
        travel = 0;
      }
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      travel = 0;
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
