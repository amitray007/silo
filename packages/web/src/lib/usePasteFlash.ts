import { useEffect, useRef, useState } from 'react';

/**
 * A timed flash-message hook for the Library header's paste-capture button
 * (`LibraryView.tsx`'s `PasteCaptureButton`) — mirrors `useCopyFlash`
 * (`SettingsTabs/copyFlash.ts`) exactly in shape: message state + a
 * `useRef` timer + unmount `clearTimeout` cleanup, so a flash set right
 * before the component unmounts (e.g. navigating away mid-toast) never
 * calls `setState` on an unmounted component (the same `ce-correctness`
 * bug `useCopyFlash` was built to fix — reused here rather than
 * reinvented, since a component-local inline timer would duplicate that
 * exact cleanup logic and trip `jscpd`).
 *
 * Deliberately a MESSAGE-STRING flash (not `useCopyFlash`'s boolean
 * tri-state) — the paste button has more than two outcomes (empty
 * clipboard / not-a-URL / blocked / success), so the message itself IS the
 * state; a separate ok/fail flag would just duplicate what the string
 * already encodes.
 */
export function usePasteFlash() {
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // Holds the pending "clear the message" timer so it can be cancelled if
  // the owning component unmounts before it fires, or if a new flash
  // supersedes it before the old one clears.
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const flash = (text: string, success: boolean) => {
    setMessage(text);
    setOk(success);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setMessage(null), 1500);
  };

  return { message, ok, flash };
}
