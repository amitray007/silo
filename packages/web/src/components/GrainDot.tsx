/**
 * The "Stack" brand mark — three rounded bars (32-grid), inline SVG so the
 * geometry can live in one place and scale via the `size` prop.
 *
 * Two forms:
 *  - Bare (default): the three bars alone. Lower two use `var(--ink)` at
 *    0.34 / 0.62 opacity, top bar the amber grain gradient. Matches
 *    `public/favicon.svg` exactly. Used where the mark sits on a plain,
 *    high-contrast ground (empty state).
 *  - Plated (`plate`): the bars inside a rounded-squircle tile that is DARK
 *    in both themes (via `--mark-plate` / `--mark-plate-ink`), mirroring the
 *    Mac app icon / `.icns`. This is the brand LOCKUP form used in the sidebar
 *    and mobile drawer: the tile gives the mark a container so it reads as a
 *    logo, and it fixes the low-contrast bottom bar (the 0.34-opacity bar
 *    washed out against the sidebar's `bg-2`) by giving every bar a controlled
 *    dark ground where the amber grain also pops. (A theme-inverted light tile
 *    was tried and rejected — it kills the amber's contrast in dark mode.)
 *
 * The amber top bar is brand-fixed (never theme-flipped) in both forms.
 * Brand mark only, never chrome — see docs/design/tokens.md.
 */
export function GrainDot({ size = 15, plate = false }: { size?: number; plate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="silo">
      <defs>
        <linearGradient id="silo-mark-grain" x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0%" stopColor="#e8b054" />
          <stop offset="100%" stopColor="#c98f2d" />
        </linearGradient>
      </defs>
      {plate ? (
        <>
          {/* Dark squircle plate in BOTH themes (matches the Mac app icon). A
              hairline edge keeps the near-black tile off the near-black
              sidebar in dark mode. */}
          <rect
            x="0.5"
            y="0.5"
            width="31"
            height="31"
            rx="8"
            fill="var(--mark-plate)"
            stroke="var(--mark-plate-edge)"
          />
          {/* Bars sit on the plate, so they use the plate's OWN ink token
              (`--mark-plate-ink`) for full contrast regardless of app theme.
              Tightened to x=8..24 so the glyph fills the tile. */}
          <rect
            x="8"
            y="20.5"
            width="16"
            height="4.5"
            rx="2.25"
            fill="var(--mark-plate-ink)"
            opacity="0.42"
          />
          <rect
            x="8"
            y="13.75"
            width="16"
            height="4.5"
            rx="2.25"
            fill="var(--mark-plate-ink)"
            opacity="0.72"
          />
          <rect x="8" y="7" width="16" height="4.5" rx="2.25" fill="url(#silo-mark-grain)" />
        </>
      ) : (
        <>
          <rect x="7" y="19.5" width="18" height="5" rx="2.5" fill="var(--ink)" opacity="0.34" />
          <rect x="7" y="12.5" width="18" height="5" rx="2.5" fill="var(--ink)" opacity="0.62" />
          <rect x="7" y="5.5" width="18" height="5" rx="2.5" fill="url(#silo-mark-grain)" />
        </>
      )}
    </svg>
  );
}
