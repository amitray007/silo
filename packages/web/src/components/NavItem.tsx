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
  default: { fontWeight: 500, inactiveColor: 'var(--mut)', padding: '7px 10px' },
  settings: { fontWeight: 400, inactiveColor: 'var(--fnt)', padding: '7px 10px' },
  tag: { fontWeight: 400, inactiveColor: 'var(--mut)', padding: '5px 10px' },
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
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
        // Active = ink on the lighter --bg ground (NOT --bg2/--hov, which barely
        // differ from the sidebar) + a subtle warm shadow, so the active pill
        // reads as a raised card lifted off the --bg2 sidebar — the prototype's
        // exact `on` state (Silo-v2.html): b:var(--bg), s:0 1px 3px rgba(40,30,10,.12).
        // Never amber (tokens.md: "active = ink on raised bg, never amber").
        background: active ? 'var(--bg)' : 'transparent',
        boxShadow: active ? '0 1px 3px rgba(40, 30, 10, 0.12)' : 'none',
        transition: 'background .15s ease, color .15s ease, box-shadow .15s ease',
      }}
    >
      {icon && (
        <span style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 18 }}>
          {icon}
        </span>
      )}
      <span>{label}</span>
      {meta !== undefined && (
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.72rem',
            fontWeight: 400,
            color: 'var(--ghost)',
          }}
        >
          {meta}
        </span>
      )}
    </a>
  );
}
