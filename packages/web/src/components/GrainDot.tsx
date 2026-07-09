/**
 * The "Stack" brand mark — three rounded bars (32-grid), inline SVG so the
 * geometry can live in one place and scale via the `size` prop. The lower
 * two bars use `var(--ink)` (theme-aware — light ink, dark warm-white) at
 * 0.34 / 0.62 opacity; the top bar carries the amber grain gradient, which
 * is brand-fixed (not theme-flipped) and matches `public/favicon.svg`
 * exactly. Brand mark only, never chrome — see docs/design/tokens.md.
 */
export function GrainDot({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="silo">
      <defs>
        <linearGradient id="silo-mark-grain" x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0%" stopColor="#e8b054" />
          <stop offset="100%" stopColor="#c98f2d" />
        </linearGradient>
      </defs>
      <rect x="7" y="19.5" width="18" height="5" rx="2.5" fill="var(--ink)" opacity="0.34" />
      <rect x="7" y="12.5" width="18" height="5" rx="2.5" fill="var(--ink)" opacity="0.62" />
      <rect x="7" y="5.5" width="18" height="5" rx="2.5" fill="url(#silo-mark-grain)" />
    </svg>
  );
}
