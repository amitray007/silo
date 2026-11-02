import { useEffect, useRef } from 'react';
import { blocked, CONTROL, OWN_ARROWS } from '../dock/keyGuards';
import type { ReadAloudApi } from './useReadAloud';

/** Run a command for a key press while Listen is open. Returns true when the key was used. */
function command(event: KeyboardEvent, listen: ReadAloudApi): boolean {
  const target = event.target instanceof Element ? event.target : null;
  switch (event.key) {
    case ' ':
      if (target?.closest(CONTROL)) return false;
      // A held key repeats; the page must not scroll under it, but it toggles only once.
      if (!event.repeat) listen.toggle();
      return true;
    case 'ArrowRight':
    case 'ArrowLeft':
      // A modified arrow belongs to the browser or the page (selection, history), not to Listen.
      if (event.shiftKey || target?.closest(OWN_ARROWS)) return false;
      listen.jump(listen.index + (event.key === 'ArrowRight' ? 1 : -1));
      return true;
    case '+':
    case '=':
      listen.stepRate(1);
      return true;
    case '-':
    case '_':
      listen.stepRate(-1);
      return true;
    default:
      return false;
  }
}

/**
 * Listen's keys: Space plays or pauses, the arrows step by a sentence, + and - change the speed.
 * They run only while Listen is open, and before the Reader's own keys.
 */
export function useListenKeys(listen: ReadAloudApi) {
  const latest = useRef(listen);
  latest.current = listen;
  const active = listen.active;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (blocked(event) || !command(event, latest.current)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}
