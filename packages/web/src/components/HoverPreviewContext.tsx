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
 *
 * QA finding (full end-to-end drive): at a completely ordinary 1280px-wide
 * desktop viewport, a row's right edge (where the row's own "⋯" Options
 * trigger lives) regularly sits close enough to `window.innerWidth` that the
 * upper clamp above pulls `left` back to BEFORE `rect.right` — i.e. the card
 * renders on top of the row it's anchored to instead of beside it, covering
 * that row's own Options button so it can't be clicked while the preview is
 * showing (reproduced with a real Playwright click timing out because the
 * hover-preview's `<img>` sat at the button's coordinates). Fix: when the
 * clamped right-side placement would land before the row's right edge (no
 * real room to its right), flip the card to the row's LEFT instead of
 * squeezing it on top — mirrors the same `14`px gap.
 *
 * Independent review caught a residual case in that first fix: naively
 * flipping left isn't enough on a narrow viewport with a WIDE row (e.g. a
 * ~320px window with a row spanning most of it) — there may be no 14px-gap
 * slot on EITHER side wide enough for the 288px card without overlapping the
 * row again, just from the other direction. Below, both candidate positions
 * are clamped into `[14, viewport]` first, then whichever candidate leaves
 * more real (non-overlapping) clearance from the row wins — so on a
 * comfortable viewport this is exactly the right-or-left flip above, and on
 * a viewport too narrow to avoid overlap entirely, it degrades to "the least
 * bad of two overlaps" rather than silently assuming the left flip always
 * fully escapes the row.
 */
export function computePosition(rect: DOMRect): HoverPreviewPosition {
  const CARD_WIDTH = 288;
  const GAP = 14;

  const rightCandidate = Math.round(
    Math.max(14, Math.min(rect.right + GAP, window.innerWidth - CARD_WIDTH - 16)),
  );
  const leftCandidate = Math.round(Math.max(14, rect.left - GAP - CARD_WIDTH));

  // Clearance = how much of the card sits clear of the row on that side;
  // negative means the card overlaps the row by that many pixels.
  const rightClearance = rightCandidate - rect.right;
  const leftClearance = rect.left - (leftCandidate + CARD_WIDTH);

  const left =
    rightClearance >= 0 || rightClearance >= leftClearance ? rightCandidate : leftCandidate;
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
