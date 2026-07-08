import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * The three row "looks" v3 draws (`docs/design/app/Silo-v3.html`):
 * - `default` — Library/Trash: weight 500, `--mut` inactive color, `7px 10px` padding.
 * - `settings` — the Settings row: weight 400, `--fnt` inactive color (never
 *   `--mut`, even though it's never "active"), `7px 10px` padding.
 * - `tag` — a Tags-section row: weight 400, `--mut` inactive color, `5px 10px` padding.
 * A single named variant (vs. four independent styling props) keeps callers
 * picking a row LOOK rather than reconstructing one prop-by-prop.
 */
export type NavItemVariant = 'default' | 'settings' | 'tag';

const VARIANT_STYLE: Record<
  NavItemVariant,
  { fontWeight: number; inactiveColor: string; padding: string }
> = {
  // K3 (oat-conformance audit): 10px → var(--s2-5) exact on every variant.
  // The vertical value intentionally stays DIFFERENT between variants (7px
  // vs. 5px) — that's the deliberate row-height distinction the class doc
  // comment above describes (default/settings rows taller than tag rows),
  // not drift to fix. 7px has no clean --s* match (between --s1-5/6px and
  // --s2/8px) — left un-tokenized rather than changing the row height;
  // same for 5px, which stays literal (NOT rounded to --s1-5/6px here,
  // unlike NavItem's own doc-comment guidance for OTHER 5/6 gaps — rounding
  // it would nudge tag rows 1px taller, a real visible change to leave out
  // of a token-migration-only pass).
  default: { fontWeight: 500, inactiveColor: 'var(--mut)', padding: '7px var(--s2-5)' },
  settings: { fontWeight: 400, inactiveColor: 'var(--fnt)', padding: '7px var(--s2-5)' },
  tag: { fontWeight: 400, inactiveColor: 'var(--mut)', padding: '5px var(--s2-5)' },
};

interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  label: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  href: string;
  /** Leading icon slot (v3: inline SVGs for Library/Trash/Settings). Tags pass none. */
  icon?: ReactNode;
  /** Which of v3's three row looks to render; default `'default'` (Library/Trash). */
  variant?: NavItemVariant | undefined;
}

/**
 * A sidebar nav row (Library / Trash / a tag). Presentational — renders a
 * plain `<a>` so callers (e.g. react-router's NavLink via `asChild`-style
 * prop spreading, or a direct href) can drive navigation; W5 wraps this with
 * whatever router primitive it uses.
 *
 * Active state = ink text on a raised `--hov` background — NEVER amber, per
 * the binding Oat rule ("amber never fills a control").
 */
export function NavItem({
  label,
  meta,
  active = false,
  href,
  icon,
  variant = 'default',
  ...anchorProps
}: NavItemProps) {
  const { fontWeight, inactiveColor, padding } = VARIANT_STYLE[variant];
  return (
    <a
      {...anchorProps}
      href={href}
      aria-current={active ? 'page' : undefined}
      className="silo-nav-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2-5)',
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        padding,
        borderRadius: 8,
        fontSize: '0.84rem',
        fontWeight,
        cursor: 'pointer',
        textDecoration: 'none',
        color: active ? 'var(--ink)' : inactiveColor,
        // Active = ink on a filled `--surface-active` box with a hairline
        // `--line` edge — the SAME family as the hover pill's `--hov`/
        // `--surface-hover` fill, one step darker/more saturated so the
        // active row reads as a clearly highlighted BOX, not just bold/ink
        // text (direct user feedback fix: the previous `background:
        // var(--bg)` was literally invisible in dark mode — the sidebar rail
        // sits `transparent` directly on the app's own `--bg` ground, so
        // painting the active row the same color as its own backdrop
        // produced no visible box at all). `--elev-1` keeps a subtle lift so
        // the active pill still reads as raised, not flat-painted.
        // Never amber (tokens.md: "active = ink on raised bg, never amber").
        // The INACTIVE background is intentionally omitted here (review fix,
        // CodeRabbit): inline styles always beat CSS class rules regardless
        // of specificity, so an inline `background: 'transparent'` for the
        // non-active case would silently defeat `.silo-nav-item:hover`'s
        // `--hov` background in base.css — the hover feedback would never
        // actually paint. Only the ACTIVE case sets an inline background
        // (it's a per-instance boolean CSS can't express); the resting/hover
        // background for every other row is CSS-owned.
        ...(active
          ? {
              background: 'var(--surface-active)',
              boxShadow: `var(--elev-1), inset 0 0 0 1px var(--line)`,
            }
          : {}),
        transform: 'scale(1)',
        transition:
          'background .15s ease, color .15s ease, box-shadow .15s ease, transform .1s var(--ease-out)',
      }}
    >
      {icon && (
        <span style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 18 }}>
          {icon}
        </span>
      )}
      <span>{label}</span>
      {meta !== undefined && (
        // `lineHeight: 1` matches the Search row's `/` shortcut chip (fix,
        // direct user feedback) — both sit on the identical collapsed
        // line-box baseline instead of the body's inherited 1.55, so the
        // count column and the chip above it land on one shared vertical
        // center.
        <span
          style={{
            marginLeft: 'auto',
            lineHeight: 1,
            fontSize: '0.72rem',
            fontWeight: 400,
            color: 'var(--fnt)',
          }}
        >
          {meta}
        </span>
      )}
    </a>
  );
}
