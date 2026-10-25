import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LinkJson } from '../api/types';
import { layoutMedia } from '../lib/breakpoints';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import { Chip } from './Chip';
import { useMenuClosing } from './MenuPresence';

export function LinkIdentity({ link }: { link: LinkJson }) {
  const domain = deriveDomain(link.url);
  return (
    <div className="silo-menu-heading">
      <Chip domain={domain} size={18} />
      <div>
        <div className="silo-menu-title">{link.title || deriveTitleFromUrl(link.url)}</div>
        <div className="silo-menu-domain">{domain}</div>
      </div>
    </div>
  );
}

/** Arrow navigation is shared by menus and tag suggestions. */
function moveMenuFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'),
  );
  if (!rows.length) return;
  event.preventDefault();
  event.stopPropagation();
  const current = rows.indexOf(document.activeElement as HTMLElement);
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? rows.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
  rows[index]?.focus({ preventScroll: true });
}

export function MenuSurface({
  children,
  className = '',
  onClose,
  link,
  onMouseEnter,
  onMouseLeave,
  sheet = true,
}: {
  children: ReactNode;
  sheet?: boolean;
  className?: string;
  onClose: () => void;
  link?: LinkJson | undefined;
  onMouseEnter?: (() => void) | undefined;
  onMouseLeave?: (() => void) | undefined;
}) {
  const closing = useMenuClosing();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const phone = sheet && matchMedia(layoutMedia.phone).matches;
  useEffect(() => {
    const trigger = document.activeElement;
    const panel = ref.current;
    const boundary = panel?.parentElement?.classList.contains('silo-menu-presence')
      ? panel.parentElement.parentElement
      : panel?.parentElement;
    panel
      ?.querySelector<HTMLElement>('input, button:not(:disabled), a[href]')
      ?.focus({ preventScroll: true });
    const pointer = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element && event.target.closest('[data-reader-menu]')) &&
        !panel?.contains(event.target as Node) &&
        !boundary?.contains(event.target as Node)
      )
        close.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      const menus = document.querySelectorAll('[data-reader-menu]');
      if (event.key !== 'Escape' || menus[menus.length - 1] !== panel) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('mousedown', pointer);
    return () => {
      document.removeEventListener('mousedown', pointer);
      document.removeEventListener('keydown', keyboard, true);
      if (
        trigger instanceof HTMLElement &&
        trigger.isConnected &&
        (!document.activeElement ||
          document.activeElement === document.body ||
          panel?.contains(document.activeElement))
      )
        trigger.focus({ preventScroll: true });
    };
  }, []);
  const panel = (
    <div
      className={`silo-popover silo-menu-surface ${className}`}
      role="menu"
      aria-label="Link actions"
      ref={ref}
      data-reader-menu={closing ? undefined : true}
      data-closing={closing}
      aria-hidden={closing || undefined}
      inert={closing}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={(event) => {
        moveMenuFocus(event);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (phone && event.key === 'Tab') {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'input, button:not(:disabled), a[href]',
            ),
          );
          const next = event.shiftKey ? controls.at(-1) : controls[0];
          if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
            event.preventDefault();
            next?.focus({ preventScroll: true });
          }
        }
      }}
    >
      <div className="silo-menu-grab" />
      {link && <LinkIdentity link={link} />}
      {children}
    </div>
  );
  return phone
    ? createPortal(
        <div className="silo-menu-sheet-layer">
          <button
            type="button"
            className="silo-menu-scrim"
            aria-label="Close menu"
            onClick={onClose}
          />
          {panel}
        </div>,
        document.body,
      )
    : panel;
}

export function MenuAction({
  children,
  icon,
  shortcut,
  danger = false,
  href,
  onClick,
  disabled = false,
  pressed,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  shortcut?: string;
  danger?: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  title?: string | undefined;
}) {
  const content = (
    <>
      <span className="silo-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="silo-menu-label">{children}</span>
      {shortcut && (
        <span className="silo-menu-shortcut" aria-hidden="true">
          <kbd>{shortcut}</kbd>
        </span>
      )}
    </>
  );
  const className = `silo-menu-item${danger ? ' silo-menu-danger' : ''}`;
  return href ? (
    <a
      role="menuitem"
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      role="menuitem"
      className={className}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-current={pressed ? 'true' : undefined}
    >
      {content}
    </button>
  );
}
