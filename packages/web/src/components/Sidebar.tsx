import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { useCounts, useTags, useUpdateSettings } from '../api/hooks';
import type { TagCount } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatCount } from '../lib/formatCount';
import { useTheme } from '../theme/ThemeProvider';
import { BrandMark } from './BrandMark';
import { LibraryIcon, LogOutIcon, SearchIcon, SettingsIcon } from './NavIcons';
import { NavItem, type NavItemVariant } from './NavItem';
import { ReaderIcon } from './reader/ReaderIcon';
import { useSettings } from './SettingsContext';
import { SidebarTags } from './SidebarTags';

const noop = () => {};

function NavItemLink({
  to,
  label,
  meta,
  end = false,
  icon,
  variant,
  onNavigate,
  onBeforeNavigate,
  skipNavigate = false,
}: {
  to: string;
  label: ReactNode;
  meta?: React.ReactNode;
  end?: boolean;
  icon?: ReactNode;
  variant?: NavItemVariant | undefined;
  onNavigate: () => void;
  onBeforeNavigate?: () => void;
  skipNavigate?: boolean;
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
    if (!skipNavigate) navigate(to);
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

function SearchShortcutChip() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        lineHeight: 1,
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--ghost)',
        border: '0.5px solid var(--line)',
        borderRadius: 4,
        padding: 4,
        margin: '-3px 0',
        background: 'color-mix(in oklch, var(--hov) 50%, transparent)',
      }}
    >
      <span aria-hidden="true">⌘</span>
      <span>K</span>
    </span>
  );
}

function SidebarSearchItem({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <NavItem
      label="Search"
      icon={<SearchIcon size={16} stroke="currentColor" />}
      meta={<SearchShortcutChip />}
      onClick={onOpenSearch}
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
  /** Opens the command palette (plan 024) — the Search nav item's click handler. */
  onOpenSearch?: () => void;
  onToggleSidebar?: () => void;
}

export const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(function Sidebar(
  { id, open = false, onNavigate = noop, onOpenSearch = noop, onToggleSidebar = noop },
  ref,
) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const updateSettings = useUpdateSettings();
  const dark = theme === 'dark';
  const { data: counts } = useCounts();
  const { data: tagsData, isError: tagsErrored, isLoading: tagsLoading } = useTags();
  const { openSettings } = useSettings();
  const { state: authState, logout } = useAuth();

  // The brand row (grain dot + "silo") acts as a home link — clicking it
  // navigates to the Library (`/`), like a site logo. A real `<a href="/">`
  // (so ⌘/ctrl-click and middle-click open a new tab natively), with a
  // preventDefault + `navigate('/')` for the plain click to stay a
  // client-side transition; `onNavigate()` closes the mobile drawer, matching
  // the nav items' behavior.
  const onBrandClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    navigate('/');
    onNavigate();
  };

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
      <div className="silo-sidebar-brandrow">
        <a
          href="/"
          onClick={onBrandClick}
          aria-label="silo home"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: 0,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <BrandMark size={24} />
          <span className="silo-sidebar-wordmark">silo</span>
        </a>
        <button
          type="button"
          className="silo-reader-iconbtn"
          aria-label={open ? 'Close sidebar' : 'Collapse sidebar'}
          onClick={onToggleSidebar}
        >
          <ReaderIcon name={open ? 'close' : 'sidebar'} />
        </button>
      </div>

      <SidebarSearchItem onOpenSearch={onOpenSearch} />

      <NavItemLink
        to="/"
        end
        label="Library"
        meta={counts ? formatCount(counts.live) : undefined}
        icon={<LibraryIcon />}
        onNavigate={onNavigate}
      />
      <SidebarTags
        tags={tags}
        loading={tagsLoading}
        renderTagLink={(tag: TagCount) => (
          <NavItemLink
            key={tag.name}
            to={`/tags/${encodeURIComponent(tag.name)}`}
            // The `#` sits in NavItem's 18px icon slot (not inline in the
            // label) so it aligns to the SAME left ledger column as the
            // Library/Trash nav icons above and the `+ New tag` glyph below —
            // one clean column, matching shiori's Tags spacing. Dim (--ghost)
            // glyph, bright (--ink) label.
            icon={<span style={{ color: 'var(--fnt)', fontSize: 'var(--text-md)' }}>#</span>}
            label={tag.name}
            meta={tag.count > 0 ? formatCount(tag.count) : undefined}
            variant="tag"
            onNavigate={onNavigate}
          />
        )}
      />

      <div className="silo-sidebar-grow" />
      <NavItemLink
        to="/settings"
        label="Settings"
        icon={<SettingsIcon />}
        variant="settings"
        onNavigate={onNavigate}
        onBeforeNavigate={() => openSettings()}
        skipNavigate
      />

      <NavItem
        label={dark ? 'Light mode' : 'Dark mode'}
        icon={<ReaderIcon name={dark ? 'sun' : 'moon'} />}
        onClick={() => {
          const next = dark ? 'light' : 'dark';
          setTheme(next);
          updateSettings.mutate({ theme: next });
        }}
      />
      {authState === 'authed' && (
        // Only rendered when a session is actually active — an 'open'
        // (no-password) deployment or localhost dev never had anything to
        // log out of, so no button shows there at all. Button mode (no
        // `href`, like the Search row above) since there's no `/logout`
        // route to link to; goes through the SAME shared `NavItem` the
        // Settings row uses (`variant="settings"`, matching its dimmer
        // secondary-row look) rather than hand-rolling inline styles — the
        // established no-drift rule (see `SidebarSearchItem`'s own comment).
        <NavItem
          label="Log out"
          icon={<LogOutIcon />}
          variant="settings"
          onClick={() => {
            logout();
          }}
        />
      )}
    </nav>
  );
});
