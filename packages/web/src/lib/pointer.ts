/**
 * Is the primary pointer hover-capable (plan 011, V3-8)? The hover-preview
 * card is a pointer-hover affordance — on a touch device there is no
 * "hover", so a `touchstart`/tap would otherwise schedule a preview that can
 * never be meaningfully dismissed by moving the pointer away. Mirrors
 * `theme.ts`'s `readSystemTheme` shape (an injectable `matchMediaFn` so tests
 * can fake it without touching global `window.matchMedia`), checking the
 * standard `(hover: hover)` media feature rather than sniffing
 * `ontouchstart`/`navigator.maxTouchPoints` (those fire true on hybrid
 * touch+mouse laptops, which DO support hover).
 */
export function isHoverCapable(matchMediaFn: typeof matchMedia = matchMedia): boolean {
  return matchMediaFn('(hover: hover)').matches;
}

/** Is the primary pointer a finger? A phone's selection handles and native menus follow from it. */
export function isCoarsePointer(
  matchMediaFn: typeof matchMedia | undefined = globalThis.matchMedia,
) {
  return matchMediaFn?.('(pointer: coarse)').matches ?? false;
}

/** A finger is the only pointer (a phone). A touch laptop or a tablet with a trackpad is not. */
export function isTouchOnly(matchMediaFn: typeof matchMedia | undefined = globalThis.matchMedia) {
  return isCoarsePointer(matchMediaFn) && !matchMediaFn?.('(any-pointer: fine)').matches;
}
