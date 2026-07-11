import type { CSSProperties } from 'react';

/**
 * A loading placeholder block — the shared primitive for every "data hasn't
 * arrived yet" surface (the Access-tab token list, the MCP setup dialog's URL,
 * Trash/Library list rows). Replaces the per-view ad-hoc loaders that had
 * drifted (TrashView's static `--bg2` blocks, etc.) with one consistent,
 * Oat-styled shimmer.
 *
 * PRESENTATIONAL + `aria-hidden`: a skeleton is decorative — the LOADING
 * SEMANTICS belong on the CONTAINER (a `role="status"` `aria-label="Loading…"`
 * wrapper, matching the app's existing pattern), not on each block, so assistive
 * tech announces "loading" ONCE rather than reading N placeholder rectangles.
 *
 * The shimmer is a light band sweeping L→R over a `--bg2` base (the
 * `siloShimmer` keyframe in `base.css`), animating only `background-position`
 * so it never triggers layout. Under `prefers-reduced-motion` the global
 * `* { animation: none }` rule (base.css) stills it, and the element falls back
 * to the flat `--bg2` base color — a clean, motionless placeholder, no special
 * casing needed here. Tuned to read in BOTH Oat themes: the base + the shimmer
 * band are both token-derived (`--bg2` / `--line`), so dark mode's deeper
 * surface + hairline apply automatically.
 */
export function Skeleton({
  width = '100%',
  height,
  radius = 8,
  style,
}: {
  /** Block width — a number (px) or any CSS length/percent. Defaults to filling the container. */
  width?: number | string;
  /** Block height in px. Required — a skeleton must reserve the real content's vertical space so nothing shifts when it lands. */
  height: number;
  /** Corner radius in px (default 8, matching the app's field/row radius). */
  radius?: number;
  /** Optional extra style merged last (e.g. `marginBottom` for stacked rows). */
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: radius,
        // `--bg2` base with a slightly-lighter (`--line`) band; the 200%-wide
        // gradient is what the `siloShimmer` keyframe slides via
        // background-position. The band is deliberately subtle (a hint of
        // sheen, not a hard highlight) so it reads as "loading", not "selected".
        background: 'linear-gradient(90deg, var(--bg2) 25%, var(--line) 50%, var(--bg2) 75%)',
        backgroundSize: '200% 100%',
        animation: 'siloShimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}
