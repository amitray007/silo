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

/**
 * Hover-preview timing. Two show delays instead of v3's single 350ms — the
 * "warm switch" case (a preview is ALREADY open and the pointer moves to
 * another row) is what felt laggy: you've clearly committed to browsing
 * previews, so re-waiting the full cold-start delay on every row switch is
 * dead time. So:
 * - COLD (nothing open yet): a short delay so a quick pass over rows doesn't
 *   flicker a preview open on a row you're just passing over. Trimmed from
 *   v3's 350ms to 160ms — enough to swallow an incidental pass, snappy on a
 *   deliberate hover.
 * - WARM (a preview is open, switching rows): near-instant — the card just
 *   moves to the new row. A tiny 30ms debounce still coalesces a fast drag
 *   across several rows into one settle, without any perceptible wait.
 * Hide delay is unchanged (short, so moving pointer row→card doesn't close it
 * mid-transit).
 */
const SHOW_DELAY_COLD_MS = 160;
const SHOW_DELAY_WARM_MS = 30;
const HIDE_DELAY_MS = 140;

/**
 * Clamped 288px-card placement from a hovered row's bounding rect (v3's
 * `enter` handler, `Silo-v3.html:813-816`): right of the row with a 14px gap,
 * clamped so the card never runs off the viewport. This keeps the preview
 * visually attached to the row (like the Shiori reference) instead of docking
 * at the far right edge of a wide app window.
 *
 * If there is not enough room to the right, the card flips to the row's left
 * with the same gap. On very narrow viewports, both candidates are clamped
 * into the visible range and the side with less row overlap wins.
 */
export function computePosition(rect: DOMRect): HoverPreviewPosition {
  const CARD_WIDTH = 288;
  const EDGE_MARGIN = 16;
  const ROW_GAP = 14;
  const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - CARD_WIDTH - EDGE_MARGIN);

  const clampLeft = (left: number) => Math.max(EDGE_MARGIN, Math.min(left, maxLeft));
  const rightCandidate = clampLeft(rect.right + ROW_GAP);
  const leftCandidate = clampLeft(rect.left - CARD_WIDTH - ROW_GAP);

  const rightOverlap = Math.max(0, rect.right - rightCandidate);
  const leftOverlap = Math.max(0, leftCandidate + CARD_WIDTH - rect.left);
  const left = Math.round(
    rightOverlap <= 0 || rightOverlap <= leftOverlap ? rightCandidate : leftCandidate,
  );
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
  // Tracks whether a preview is currently on screen, read synchronously inside
  // the `[]`-deps `scheduleShow` callback (which can't see `preview` state
  // without going stale) to pick the warm vs cold show delay. Kept in sync
  // with `preview` via the effect below.
  const isShowingRef = useRef(false);

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

  // Keep `isShowingRef` in lockstep with whether a preview is on screen, so
  // `scheduleShow` can read it synchronously (its `[]` deps can't see the
  // `preview` state directly). Cheap: runs only when `preview` toggles.
  useEffect(() => {
    isShowingRef.current = preview !== null;
  }, [preview]);

  const scheduleShow = useCallback(
    (link: LinkJson, rect: DOMRect, options?: { suppress?: boolean }) => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (options?.suppress) return;

      // WARM (a preview already open → just move it to this row) is near-
      // instant; COLD (opening the first preview) keeps a short delay so a
      // quick pass over rows doesn't flicker one open. This is the fix for
      // "switching between links takes too long": the wait only ever applies
      // to the first open, not to every subsequent row switch.
      const delay = isShowingRef.current ? SHOW_DELAY_WARM_MS : SHOW_DELAY_COLD_MS;
      showTimer.current = setTimeout(() => {
        setPreview({ link, position: computePosition(rect) });
      }, delay);
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

  // Global pointer-fallback dismiss (fixes "the preview gets STUCK when
  // switching between links quickly"). Normal dismissal relies on a row's
  // `mouseleave` firing `scheduleHide` (or the card's `mouseleave` firing
  // `hide`). But on a FAST pointer sweep across the list, the browser
  // coalesces/skips the intervening `mouseleave` of the last-previewed row,
  // and the floating card (which sits ~14px off the row) can sit under the
  // pointer's path — so the final `scheduleShow` renders a preview for which
  // no matching `scheduleHide` ever fires. The card then floats with the
  // pointer nowhere near it. This listener — armed ONLY while a preview is on
  // screen, so there's zero cost otherwise — watches raw pointer moves and,
  // whenever the pointer is over NONE of a library link row (`.silo-link-row`),
  // a command-palette row (`.silo-palette-row`), or the preview card
  // (`.silo-popover`), closes the preview. That's the one signal the
  // per-element `mouseleave` handlers can drop; the row/card enter handlers
  // still own the normal open/keep path, so this only ever fires in the
  // genuinely-left-everything case.
  //
  // `.silo-palette-row` MUST be whitelisted here (palette-rich-rows slice):
  // the command palette now also opens this shared preview, and its rows carry
  // that class, NOT `.silo-link-row`. Without it, any pointer move landing on a
  // palette row (e.g. a tiny jitter while the card is up, or moving between two
  // palette rows) reads as "left everything" and wrongly dismisses the
  // palette's own hover card — a real bug caught in browser QA.
  useEffect(() => {
    if (preview === null) return;
    const onPointerMove = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        target?.closest('.silo-link-row') ||
        target?.closest('.silo-palette-row') ||
        target?.closest('.silo-popover')
      )
        return;
      hide();
    };
    document.addEventListener('pointermove', onPointerMove);
    return () => document.removeEventListener('pointermove', onPointerMove);
  }, [preview, hide]);

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
