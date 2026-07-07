/**
 * The enriching-state favicon replacement (user-picked, reference-studied): a
 * 3×3 dot grid that gently shimmers while a freshly-captured link is still
 * enriching in the background — shown IN PLACE of the favicon `Chip`, at the
 * same 20px footprint, so the row layout doesn't shift. Paired with a dimmed
 * row (see `LinkRow`), it reads as "this is working" without any status label
 * or spinner chrome. When enrichment lands (live polling, plan 014), the row
 * swaps this for the real favicon + fills in the title.
 *
 * The animation is a staggered opacity pulse across the 9 dots (a soft wave),
 * disabled under `prefers-reduced-motion` via the global rule in `base.css`
 * (`* { animation: none }`), where the dots simply sit at a mid opacity.
 */
export function EnrichingLoader() {
  return (
    <span
      aria-label="enriching"
      role="img"
      style={{
        flex: 'none',
        width: 20,
        height: 20,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: 2,
        placeItems: 'center',
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed 9-dot grid, order never changes
          key={i}
          style={{
            width: 3,
            height: 3,
            borderRadius: '50%',
            background: 'var(--fnt)',
            // Staggered wave: each dot's pulse is offset by its grid position,
            // so the shimmer sweeps diagonally across the grid.
            animation: 'siloDotPulse 1.2s ease-in-out infinite',
            animationDelay: `${((i % 3) + Math.floor(i / 3)) * 0.12}s`,
          }}
        />
      ))}
    </span>
  );
}
