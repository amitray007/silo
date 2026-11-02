import { useEffect, useRef } from 'react';
import { blocked, CONTROL, OWN_ARROWS } from '../dock/keyGuards';
import type { PencilApi } from './usePencil';

/** Run a command for a key press while the pencil is on. Returns true when the key was used. */
function whileOn(event: KeyboardEvent, pencil: PencilApi): boolean {
  const target = event.target instanceof Element ? event.target : null;
  switch (event.key) {
    case ' ':
      if (target?.closest(CONTROL)) return false;
      // A held key repeats; the page must not scroll under it, but it toggles only once.
      if (!event.repeat) pencil.togglePlay();
      return true;
    case 'ArrowDown':
    case 'ArrowUp':
      if (target?.closest(OWN_ARROWS)) return false;
      pencil.move(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    case '+':
    case '=':
      pencil.faster();
      return true;
    case '-':
    case '_':
      pencil.slower();
      return true;
    default:
      return false;
  }
}

function command(event: KeyboardEvent, pencil: PencilApi): boolean {
  if (event.key === 'p' && !event.repeat) {
    pencil.toggleEnabled();
    return true;
  }
  if (!pencil.enabled) return false;
  if (event.key === 'Escape') {
    // An open sheet, menu or the notes lane takes the key first; the pencil turns off on the next press.
    if (document.querySelector('[data-reader-menu], [data-notes-lane], [data-notes-open]'))
      return false;
    pencil.stop();
    return true;
  }
  return whileOn(event, pencil);
}

/**
 * The pencil's keys. They run before the Reader's own, so a key the pencil uses is not also a
 * link step or a Reader close. Anything else passes through untouched.
 */
export function usePencilKeys(pencil: PencilApi) {
  const latest = useRef(pencil);
  latest.current = pencil;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (blocked(event) || !command(event, latest.current)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
