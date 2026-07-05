import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useCounts, useTags } from '../api/hooks';
import type { TagCount } from '../api/types';
import { GrainDot } from './GrainDot';
import { LibraryIcon, SettingsIcon, TrashIcon } from './NavIcons';
import { NavItem, type NavItemVariant } from './NavItem';
import { useSettings } from './SettingsContext';
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
 *
 * `onBeforeNavigate` (optional) runs before the `navigate(to)` call — the
 * Settings item uses it to also open the Settings modal in the same click,
 * so the item stays a real, linkable `/settings` anchor (bookmarkable,
 * correct `aria-current`) while ALSO triggering v3's modal-open behavior
 * (`openSettings`) rather than only rendering a route.
 */
function NavItemLink({
  to,
  label,
  meta,
  end = false,
  icon,
  variant,
  onNavigate,
  onBeforeNavigate,
}: {
  to: string;
  label: string;
  meta?: React.ReactNode;
  end?: boolean;
  icon?: ReactNode;
  variant?: NavItemVariant | undefined;
  onNavigate: () => void;
  onBeforeNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const match = useMatch({ path: to, end });
  const active = match !== null;

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    onBeforeNavigate?.();
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
 * grows to fill available space). The Settings button both navigates to
 * `/settings` (keeping it a real, linkable nav item) AND opens the shared
 * Settings modal (plan 011, V3-7) via `useSettings().openSettings()` — v3's
 * `openSettings` is a modal trigger, not a route change, so this reproduces
 * that behavior while keeping the route linkable. The light/dark theme
 * toggle that used to live here has MOVED into Settings → Preferences (v3
 * only shows it there, not in the sidebar).
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
  const { openSettings } = useSettings();

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

      <NavItemLink
        to="/settings"
        label="Settings"
        icon={<SettingsIcon />}
        variant="settings"
        onNavigate={onNavigate}
        onBeforeNavigate={() => openSettings()}
      />
    </nav>
  );
});
