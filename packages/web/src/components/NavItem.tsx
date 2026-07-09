import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The three row "looks" v3 draws (`docs/design/app/Silo-v3.html`):
 * - `default` — Library/Trash: weight 500, `--ink` inactive color, `7px 10px` padding.
 * - `settings` — the Settings row: weight 400, `--mut` inactive color (never
 *   `--ink`, even though it's never "active"), `7px 10px` padding.
 * - `tag` — a Tags-section row: weight 400, `--ink` inactive color, `5px 10px` padding.
 * Inactive labels for `default`/`tag` match the active `--ink` color — the
 * active/inactive distinction is carried entirely by the `--surface-active`/
 * `--hov` highlight box (see the `active` styling below), not by dimming the
 * label text, so a resting nav row never reads as muddy (direct user
 * feedback: primary nav labels rendered in `--mut` looked too dim to read as
 * the crisp, clickable labels they are). `settings` deliberately stays one
 * step dimmer at `--mut` — it's a secondary/utility row, never "active".
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
  default: { fontWeight: 500, inactiveColor: 'var(--ink)', padding: '7px var(--s2-5)' },
  settings: { fontWeight: 400, inactiveColor: 'var(--mut)', padding: '7px var(--s2-5)' },
  tag: { fontWeight: 400, inactiveColor: 'var(--ink)', padding: '5px var(--s2-5)' },
};

interface NavItemSharedProps {
  label: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  /** Leading icon slot (v3: inline SVGs for Library/Trash/Settings). Tags pass none. */
  icon?: ReactNode;
  /** Which of v3's three row looks to render; default `'default'` (Library/Trash). */
  variant?: NavItemVariant | undefined;
}

interface NavItemAnchorProps
  extends NavItemSharedProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'style' | 'color'> {
  /** A real, linkable route — renders an `<a>`. */
  href: string;
}

interface NavItemButtonProps
  extends NavItemSharedProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color' | 'type'> {
  /** No route to link to (e.g. Search, which opens a palette in place) — renders a `<button type="button">`. */
  href?: undefined;
}

type NavItemProps = NavItemAnchorProps | NavItemButtonProps;

/**
 * A sidebar nav row (Library / Trash / a tag / Search). Presentational —
 * renders a plain `<a>` when given `href` (so callers, e.g. react-router's
 * `NavLink` via `asChild`-style prop spreading, or a direct href, can drive
 * navigation; W5 wraps this with whatever router primitive it uses), or a
 * `<button type="button">` when `href` is omitted (plan 024's Search row,
 * which has no `/route` of its own and just opens the floating palette in
 * place). Both element types share IDENTICAL styling — icon slot, meta slot,
 * padding, font, active/hover chrome — so a row's LOOK never depends on
 * which element it renders as.
 *
 * Active state = ink text on a raised `--hov` background — NEVER amber, per
 * the binding Oat rule ("amber never fills a control"). `aria-current` only
 * ever applies to the anchor form — a button has no "current page" to mark.
 */
export function NavItem({
  label,
  meta,
  active = false,
  icon,
  variant = 'default',
  ...props
}: NavItemProps) {
  const { fontWeight, inactiveColor, padding } = VARIANT_STYLE[variant];

  const sharedStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--s2-5)',
    width: '100%',
    boxSizing: 'border-box' as const,
    textAlign: 'left' as const,
    padding,
    borderRadius: 8,
    fontSize: 'var(--text-base)',
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
  };

  const children = (
    <>
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
            fontSize: 'var(--text-xs)',
            fontWeight: 400,
            color: 'var(--fnt)',
          }}
        >
          {meta}
        </span>
      )}
    </>
  );

  if (props.href !== undefined) {
    const { href, ...anchorProps } = props as Omit<NavItemAnchorProps, keyof NavItemSharedProps>;
    return (
      <a
        {...anchorProps}
        href={href}
        aria-current={active ? 'page' : undefined}
        className="silo-nav-item"
        style={sharedStyle}
      >
        {children}
      </a>
    );
  }

  const buttonProps = props as Omit<NavItemButtonProps, keyof NavItemSharedProps>;
  return (
    <button
      {...buttonProps}
      type="button"
      className="silo-nav-item"
      style={{
        ...sharedStyle,
        // A native `<button>` carries its own UA form-control chrome (a
        // border, a system font-family, `appearance: auto`) that an `<a>`
        // never has — left alone, `appearance: auto` makes Chromium apply
        // its own intrinsic form-control sizing ON TOP OF the flex content
        // size, so the row rendered ~4px taller than the byte-identical
        // anchor row despite matching padding/font-size/line-height
        // (row-parity fix, this diff). `appearance: none` drops that
        // reserved sizing; `border: 0` + `fontFamily: inherit` +
        // `background: none` strip the rest of the UA chrome. Deliberately
        // NOT the `font` shorthand — it also resets size/weight/line-height,
        // which would silently clobber the explicit values `sharedStyle`
        // sets just above (object spread order: these keys apply AFTER
        // `sharedStyle`, so `font: 'inherit'` would win and undo them).
        appearance: 'none',
        WebkitAppearance: 'none',
        border: 0,
        fontFamily: 'inherit',
        background: 'none',
      }}
    >
      {children}
    </button>
  );
}
