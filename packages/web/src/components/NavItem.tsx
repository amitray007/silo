import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

/** Shared with decorative sidebar rows so loading and loaded columns align. */
export const navItemRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 6,
  fontWeight: 400,
} satisfies CSSProperties;

export type NavItemVariant = 'default' | 'settings' | 'tag';

interface NavItemSharedProps {
  label: ReactNode;
  meta?: ReactNode;
  active?: boolean;

  icon?: ReactNode;

  variant?: NavItemVariant | undefined;
}

interface NavItemAnchorProps
  extends NavItemSharedProps,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'style' | 'color'> {
  href: string;
}

interface NavItemButtonProps
  extends NavItemSharedProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color' | 'type'> {
  href?: undefined;
}

type NavItemProps = NavItemAnchorProps | NavItemButtonProps;

export function NavItem({
  label,
  meta,
  active = false,
  icon,
  variant = 'default',
  ...props
}: NavItemProps) {
  const sharedStyle = {
    ...navItemRowStyle,
    cursor: 'pointer',
    textDecoration: 'none',
    color: active ? 'var(--ink)' : 'var(--nav-color, var(--mut))',
  };

  const children = (
    <>
      {icon && <span className="silo-nav-icon">{icon}</span>}

      <span
        style={{
          flex: variant === 'tag' && props.href === undefined ? undefined : 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {meta !== undefined && (
        <span
          style={{
            marginLeft: 'auto',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: '16px',
            fontSize: 'var(--text-xs)',
            fontWeight: 400,
            color: 'var(--ghost)',
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
        data-active={active}
        data-variant={variant}
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
        appearance: 'none',
        WebkitAppearance: 'none',
        border: 0,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}
