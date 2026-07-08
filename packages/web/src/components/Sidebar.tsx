import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useCounts, useTags } from '../api/hooks';
import type { TagCount } from '../api/types';
import { GrainDot } from './GrainDot';
import { LibraryIcon, SearchIcon, SettingsIcon, TrashIcon } from './NavIcons';
import { NavItem, type NavItemVariant } from './NavItem';
import { useSettings } from './SettingsContext';
import { SidebarTags } from './SidebarTags';

const noop = () => {};

/**
 * A thin divider between sidebar sections (matches `RowMenu.tsx`'s own
 * `Divider` — `1px solid var(--line)` with a small vertical margin so the
 * rule reads as a section break, not a heavy rule).
 */
function SidebarDivider() {
  return <div style={{ borderTop: '1px solid var(--line)', margin: 'var(--s2) 0' }} />;
}

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
 * `onBeforeNavigate` (optional) runs before the `navigate(to)` call.
 *
 * `skipNavigate` (optional — the Settings item's own case, per a direct
 * user-feedback fix: "don't navigate to /settings when opening the modal")
 * suppresses the `navigate(to)` call entirely: the click only runs
 * `onBeforeNavigate` (Settings' `openSettings()`) and `onNavigate` (mobile
 * drawer close), never pushing the route. `href`/`aria-current` still point
 * at `/settings` so the item LOOKS and reads like the same linkable anchor —
 * middle-click/cmd-click/open-in-new-tab still work (native anchor behavior,
 * untouched by `onClick`) and `/settings` typed directly or followed via that
 * still opens the modal (via `SettingsView`'s own mount effect) — only a
 * plain left-click routing through THIS click handler skips the `navigate`
 * call, so the visible URL never changes for that one interaction.
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

/**
 * The Search nav row (plan 024, command center): a plain button, NOT routed
 * through `NavItemLink` — unlike every other sidebar row, Search has no
 * dedicated `/route` at all (it opens the floating palette in place, exactly
 * like the Settings item's `skipNavigate` case, but simpler still since
 * there's no `/search` URL to keep linkable either). Reuses `NavItem`'s
 * shared row look (icon/label/meta slots, `variant="default"` to match
 * Library/Trash's weight-500 styling) so it reads as part of the same nav
 * block, not a second visual language. The `/` shortcut hint renders via
 * `meta` (the same right-aligned slot Library/Trash use for their counts) —
 * `NavItem`'s `meta` accepts any `ReactNode`, so a short text hint fits
 * without a dedicated prop.
 */
function SidebarSearchItem({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenSearch}
      className="silo-nav-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2-5)',
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        padding: '7px var(--s2-5)',
        border: 0,
        borderRadius: 8,
        fontSize: '0.84rem',
        fontWeight: 500,
        color: 'var(--mut)',
        cursor: 'pointer',
        font: 'inherit',
        background: 'transparent',
      }}
    >
      <span style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 18 }}>
        <SearchIcon size={18} stroke="currentColor" />
      </span>
      <span>Search</span>
      {/* `lineHeight: 1` + `display: inline-flex` centering (direct user
          feedback fix: "the `/` chip is not vertically aligned with the
          Library/Trash count numbers"). Without an explicit line-height the
          chip inherited the body's 1.55 line-height, which gives its own
          text node a taller-than-glyph line box — the chip's border+padding
          then centers on THAT inflated box instead of the glyph itself, so
          the visible `/` sits a couple px off the row's true vertical
          center that the borderless, `lineHeight`-unset meta count spans
          (NavItem's `meta`) land on by not having the same tall line-box
          problem masked by a border. Collapsing to `lineHeight: 1` and
          flex-centering the glyph inside the chip's own box makes both
          land on the identical row-center baseline, so the chip and the
          counts below it form one clean right column. */}
      <span
        style={{
          marginLeft: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          fontSize: '0.66rem',
          color: 'var(--fnt)',
          border: '1px solid var(--line)',
          borderRadius: 5,
          padding: 'var(--s-0-5) var(--s1-5)',
          background: 'var(--bg)',
        }}
      >
        /
      </span>
    </button>
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
}

/**
 * The real, data-bound sidebar (`docs/design/app/library-sidebar-light.png`):
 * brand row, Library (live count), Trash (count only — v3's `trashMeta`,
 * per direct user feedback: the `· {purgeWindowDays}d` suffix was dropped),
 * a divider, a Tags section built from `useTags()` (count-desc order
 * preserved as returned by the API), another divider, then Settings —
 * flowing directly below Tags rather than pinned to the bottom (per direct
 * user feedback: Settings moved up so it reads as part of the same nav
 * block, not a footer). The Settings button opens the shared Settings modal
 * (plan 011, V3-7) via `useSettings().openSettings()` WITHOUT
 * navigating to `/settings` (`skipNavigate`, per a direct user-feedback fix:
 * "don't navigate to /settings when opening the modal" — Settings is a
 * popover, not a screen, so clicking it from the sidebar must not change the
 * visible route). `/settings` stays reachable/linkable as its own URL
 * (`SettingsView`'s mount effect opens the same modal) for bookmarking/deep
 * links — only THIS click path skips the route push. The light/dark theme
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
  { id, open = false, onNavigate = noop, onOpenSearch = noop },
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

      <SidebarSearchItem onOpenSearch={onOpenSearch} />

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
        meta={counts ? String(counts.trash) : undefined}
        icon={<TrashIcon />}
        onNavigate={onNavigate}
      />

      <SidebarDivider />

      <SidebarTags
        tags={tags}
        renderTagLink={(tag: TagCount) => (
          <NavItemLink
            key={tag.name}
            to={`/tags/${tag.name}`}
            label={
              <>
                <span style={{ color: 'var(--ghost)', marginRight: 4 }}>#</span>
                {tag.name}
              </>
            }
            meta={tag.count}
            variant="tag"
            onNavigate={onNavigate}
          />
        )}
      />

      <SidebarDivider />

      <NavItemLink
        to="/settings"
        label="Settings"
        icon={<SettingsIcon />}
        variant="settings"
        onNavigate={onNavigate}
        onBeforeNavigate={() => openSettings()}
        skipNavigate
      />
    </nav>
  );
});
