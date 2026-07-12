/**
 * Whether a plugin source's COMMAND-PALETTE surface (its hover preview + inline
 * line inside the cmd-k palette) should render: the source's plugin must be
 * `enabled` AND its `palette` feature on. Defaults to ON while settings are
 * still loading (`source` undefined), matching the app's optimism elsewhere
 * (mirrors `HoverPreview.tsx`'s `hoverEnabledFor` and `LinkRow`'s
 * `isInlineSurfaceOn`, but for the palette's own independent `palette` flag —
 * NOT the library `inline`/`hover` flags). Generic non-plugin links are not
 * routed through this gate at all — their palette hover always shows, matching
 * the library's `GenericVariant`.
 */
export function isPaletteSurfaceOn(
  source: { enabled: boolean; palette: boolean } | undefined,
): boolean {
  return (source?.enabled ?? true) && (source?.palette ?? true);
}
