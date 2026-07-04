import type { AnchorHTMLAttributes, ReactNode } from 'react';

interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  label: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  href: string;
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
export function NavItem({ label, meta, active = false, href, ...anchorProps }: NavItemProps) {
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
        padding: '7px 10px',
        borderRadius: 8,
        fontSize: '0.84rem',
        fontWeight: 500,
        cursor: 'pointer',
        textDecoration: 'none',
        color: active ? 'var(--ink)' : 'var(--mut)',
        background: active ? 'var(--hov)' : 'transparent',
        transition: 'background .15s ease, color .15s ease',
      }}
    >
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
