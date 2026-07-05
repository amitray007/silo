import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useCounts, useTags } from '../api/hooks';
import type { TagCount } from '../api/types';
import { ThemeToggle } from '../theme/ThemeToggle';
import { GrainDot } from './GrainDot';
import { LibraryIcon, SettingsIcon, TrashIcon } from './NavIcons';
import { NavItem, type NavItemVariant } from './NavItem';
import { SidebarTags } from './SidebarTags';

const noop = () => {};

/**
 * A `NavItem` wired to react-router: `useMatch` computes whether the current
 * location matches `to` (mirroring `NavLink`'s own `end`-aware matching) and
 * drives `NavItem`'s `active` prop; a client-side `navigate` on click keeps
 * routing in react-router's hands. We deliberately DON'T wrap `NavItem` in a
 * `<NavLink>` — that would nest two `<a>` elements (invalid HTML, and it
 * breaks `aria-current`/role queries onto the wrong anchor), so `NavItem`'s
 * own anchor stays the single, real link.
 *
 * `onNavigate` fires after a successful client-side navigation — `AppFrame`
 * uses it to close the mobile drawer when a nav item is tapped.
 */
function NavItemLink({
  to,
  label,
  meta,
  end = false,
  icon,
  variant,
  onNavigate,
}: {
  to: string;
  label: string;
  meta?: React.ReactNode;
  end?: boolean;
  icon?: ReactNode;
  variant?: NavItemVariant | undefined;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const match = useMatch({ path: to, end });
  const active = match !== null;

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
    onNavigate();
  };

  return (
    <NavItem
      label={label}
      meta={meta}
      active={active}
      href={to}
      icon={icon}
      variant={variant}
      onClick={onClick}
    />
  );
}

interface SidebarProps {
  /** DOM id the mobile ☰ button's `aria-controls` points at. */
  id?: string;
  /** Whether the drawer is open (mobile only — inert/ignored on desktop). */
  open?: boolean;
  /** Fires after a nav item navigates — closes the mobile drawer. */
  onNavigate?: () => void;
}

/**
 * The real, data-bound sidebar (`docs/design/app/library-sidebar-light.png`):
 * brand row, Library (live count), Trash (`count · purgeWindowDays`), a Tags
 * section built from `useTags()` (count-desc order preserved as returned by
 * the API), and Settings pinned to the bottom via flex (the Tags section
 * grows to fill available space).
 *
 * Doubles as the mobile off-canvas drawer: on desktop this is a static rail
 * (`.silo-sidebar`, no `@media` override applies); on mobile the same markup
 * slides in as an overlay driven by `data-open` (see `base.css`). It stays a
 * single `<nav aria-label="Sidebar">` landmark in both states — open or
 * closed, mobile or desktop — rather than swapping to a `dialog` role, so
 * assistive tech sees one stable, correctly-labeled navigation region.
 *
 * Loading/empty/error states are handled calmly: while counts/tags are
 * loading we simply omit the meta/section content (no layout-shifting
 * skeleton chrome); an empty tag list renders no Tags section at all; a
 * failed tags fetch renders nothing rather than crashing the sidebar.
 */
export const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(function Sidebar(
  { id, open = false, onNavigate = noop },
  ref,
) {
  const { data: counts } = useCounts();
  const { data: tagsData, isError: tagsErrored } = useTags();

  const tags = tagsErrored ? [] : (tagsData?.tags ?? []);

  return (
    // tabIndex={-1} makes the drawer programmatically focusable (AppFrame
    // moves focus here when it opens on mobile) without adding it to the tab
    // order.
    <nav
      id={id}
      ref={ref}
      tabIndex={-1}
      aria-label="Sidebar"
      data-open={open}
      className="silo-sidebar"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px 15px' }}>
        <GrainDot size={16} />
        <span style={{ fontWeight: 500, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>silo</span>
      </div>

      <NavItemLink
        to="/"
        end
        label="Library"
        meta={counts?.live}
        icon={<LibraryIcon />}
        onNavigate={onNavigate}
      />
      <NavItemLink
        to="/trash"
        label="Trash"
        meta={counts ? `${counts.trash} · ${counts.purgeWindowDays}d` : undefined}
        icon={<TrashIcon />}
        onNavigate={onNavigate}
      />

      <SidebarTags
        tags={tags}
        renderTagLink={(tag: TagCount) => (
          <NavItemLink
            key={tag.name}
            to={`/tags/${tag.name}`}
            label={`#${tag.name}`}
            meta={tag.count}
            variant="tag"
            onNavigate={onNavigate}
          />
        )}
      />

      <span style={{ flex: 1 }} />

      <div style={{ padding: '4px 10px 8px' }}>
        <ThemeToggle />
      </div>
      <NavItemLink
        to="/settings"
        label="Settings"
        icon={<SettingsIcon />}
        variant="settings"
        onNavigate={onNavigate}
      />
    </nav>
  );
});
