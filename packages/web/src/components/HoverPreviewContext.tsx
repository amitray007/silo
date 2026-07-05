import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LinkJson } from '../api/types';
import { HoverPreview, type HoverPreviewPosition } from './HoverPreview';

/** v3's exact timing (`Silo-v3.html:817`/`:822`) — a show delay long enough that a quick mouse pass over several rows never flickers a preview open, and a short hide delay so moving the pointer row→card doesn't close it mid-transit. */
const SHOW_DELAY_MS = 350;
const HIDE_DELAY_MS = 140;

/**
 * Clamped 288px-card placement from a hovered row's bounding rect (v3's
 * `enter` handler, `Silo-v3.html:813-816`): right of the row with a 14px gap,
 * clamped so the ~288+16px card never runs off the right edge; vertically
 * anchored a hair above the row's top, clamped into `[14, viewport height −
 * 340]` so it never runs off top or bottom. `304`/`340` are v3's own
 * constants (288px card + margin / an assumed max card height), kept as-is
 * rather than re-derived from the actual (unmeasured-until-painted) card
 * size.
 *
 * `left` ALSO has a `14`px lower floor (review fix, ce-correctness) — v3's
 * own source only clamps the upper bound (`Math.min(r.right + 14,
 * window.innerWidth - 304)`), which goes negative on any viewport narrower
 * than ~304px (a resized desktop window, a narrow split-view), pushing the
 * card off the LEFT edge instead of the intended right edge. `top` already
 * clamped both bounds; `left` didn't, purely by omission — this makes them
 * symmetric.
 */
function computePosition(rect: DOMRect): HoverPreviewPosition {
  const left = Math.round(Math.max(14, Math.min(rect.right + 14, window.innerWidth - 304)));
  const top = Math.round(Math.max(14, Math.min(rect.top - 4, window.innerHeight - 340)));
  return { top, left };
}

interface HoverPreviewContextValue {
  /**
   * Row hover-enter (v3's `enter`): schedules the preview to open for `link`
   * near `rect` after the show delay. Call sites pass `suppress: true` to
   * skip scheduling entirely (this row's `⋯` menu is open, a modal is open,
   * or the pointer is a touch/coarse pointer with no real "hover") rather
   * than opening then immediately hiding — v3 has no such suppression case
   * (its demo has no touch/menu-open guard), but a hover-only hint that
   * mis-times against another open overlay was a real reviewed risk.
   */
  scheduleShow: (link: LinkJson, rect: DOMRect, options?: { suppress?: boolean }) => void;
  /** Row hover-leave (v3's `leave`): cancels a pending show, and schedules a hide for `linkId` after the hide delay (only if THIS link's preview is what's currently showing/pending — matches v3's `s2.preview.id === l.id` guard). */
  scheduleHide: (linkId: string) => void;
  /**
   * Immediately cancels any pending show/hide for `linkId` AND closes an
   * already-open preview for it, with no delay (review fix, ce-correctness +
   * ce-julik-frontend-races: a row can disappear — trashed, filtered out by a
   * refetch — without ever firing `mouseLeave`, since removing the DOM node
   * doesn't dispatch a leave event). `LinkRow` calls this from its OWN
   * unmount cleanup, which fires in both cases that matter: the row unmounts
   * WHILE a show-timer is still pending for it (would otherwise pop open a
   * preview for a link no longer on screen), and the row unmounts while its
   * preview is already showing (would otherwise leave a stale-content card
   * floating with no corresponding row). Distinct from `scheduleHide` (which
   * intentionally keeps the v3 hide DELAY for a normal mouse-leave) — this
   * is the "the row is gone, there is no delay to honor" path.
   */
  dismiss: (linkId: string) => void;
}

const HoverPreviewContext = createContext<HoverPreviewContextValue | null>(null);

/**
 * Owns the SINGLE shared hover-preview instance (plan 011, V3-8) — mounted
 * once at the app root (mirrors `RowMenuProvider`'s "one provider, not one
 * per row" shape: `RowMenuContext.tsx`'s doc comment explains why). Any row
 * across the app calls `scheduleShow`/`scheduleHide`; at most one
 * `HoverPreview` is ever mounted, positioned for whichever link last won the
 * race.
 *
 * Portal target is `document.body` (inside `HoverPreview` itself), so this
 * provider can sit anywhere in the tree without worrying about ancestor
 * `overflow`/stacking context clipping the fixed-position card.
 */
export function HoverPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<{ link: LinkJson; position: HoverPreviewPosition } | null>(
    null,
  );
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Belt-and-suspenders cleanup: clears any timer still pending if the
  // provider itself ever unmounts (it doesn't, in practice — mounted once at
  // the app root for the life of the app — but a stray timer firing
  // `setState` after unmount is exactly the kind of race
  // ce-julik-frontend-races-reviewer flags, so it's guarded regardless).
  useEffect(
    () => () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  const scheduleShow = useCallback(
    (link: LinkJson, rect: DOMRect, options?: { suppress?: boolean }) => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (options?.suppress) return;

      showTimer.current = setTimeout(() => {
        setPreview({ link, position: computePosition(rect) });
      }, SHOW_DELAY_MS);
    },
    [],
  );

  const scheduleHide = useCallback((linkId: string) => {
    if (showTimer.current) clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => {
      setPreview((current) => (current && current.link.id === linkId ? null : current));
    }, HIDE_DELAY_MS);
  }, []);

  // v3's `pvKeep` (`Silo-v3.html:1025`): entering the CARD itself cancels
  // whatever hide is pending, keeping the currently-shown preview open.
  const keep = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  // v3's `pvHide` (`Silo-v3.html:1026`): leaving the card closes it immediately
  // (no further delay — the pointer has already left both the row and the
  // card, there is nothing left to "move into").
  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setPreview(null);
  }, []);

  // See `HoverPreviewContextValue.dismiss`'s doc comment — the row-unmount
  // escape hatch. Clears BOTH timers (a pending show for a now-gone row must
  // never fire; a pending hide is moot once we force-close below) and closes
  // an already-open preview for `linkId` with no delay, via the same
  // id-guarded functional updater `scheduleHide` uses (so dismissing a row
  // whose preview ISN'T the one currently showing is a safe no-op).
  const dismiss = useCallback((linkId: string) => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setPreview((current) => (current && current.link.id === linkId ? null : current));
  }, []);

  const value = useMemo(
    () => ({ scheduleShow, scheduleHide, dismiss }),
    [scheduleShow, scheduleHide, dismiss],
  );

  return (
    <HoverPreviewContext.Provider value={value}>
      {children}
      {preview && (
        <HoverPreview link={preview.link} position={preview.position} onKeep={keep} onHide={hide} />
      )}
    </HoverPreviewContext.Provider>
  );
}

export function useHoverPreview(): HoverPreviewContextValue {
  const context = useContext(HoverPreviewContext);
  if (!context) {
    throw new Error('useHoverPreview must be used within a HoverPreviewProvider');
  }
  return context;
}
