import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useCounts, useTags } from '../api/hooks';
import type { TagCount } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatCount } from '../lib/formatCount';
import { GrainDot } from './GrainDot';
import { LibraryIcon, LogOutIcon, SearchIcon, SettingsIcon, TrashIcon } from './NavIcons';
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
 * The `⌘K` shortcut hint chip that sits in the Search row's `meta` slot —
 * shows the palette's PRIMARY trigger (⌘K/Ctrl+K still work identically;
 * `/` remains a secondary global trigger too, see `useCommandPalette.ts`,
 * but the displayed hint is the one every other command-palette-style app
 * (Linear, Raycast, Vercel) surfaces, and it's unambiguous cross-platform in
 * a way a bare `/` glyph isn't). Visually a small bordered pill (unlike
 * Library/Trash's borderless count text) but sized/centered to land on the
 * SAME right-hand column as those counts: `lineHeight: 1` + `display:
 * inline-flex` centering (direct user feedback fix, preserved from the `/`
 * chip: "the chip is not vertically aligned with the Library/Trash count
 * numbers") means the chip's border+padding center on the glyph's own
 * collapsed line-box rather than an inherited 1.55 line-height, landing it
 * on the identical row-center baseline as `NavItem`'s borderless meta spans.
 *
 * The `margin: -3px 0` (a negative vertical margin equal to the chip's own
 * border+padding, `1px` border + `2px` padding per edge) is a row-parity
 * fix: without it, the chip's border+padding grow its layout box taller
 * than a bare count span, and since `NavItem`'s row is a flex container
 * with `align-items: center`, the ROW itself stretches to fit the tallest
 * child — making the Search row ~4px taller than Library/Trash despite
 * identical padding/font on the row itself. The negative margin lets the
 * border/padding still PAINT (margin never clips rendered content) while
 * removing the chip's layout footprint beyond its glyph's own line-box, so
 * it no longer inflates the row's flex-computed height — this is purely a
 * font-metrics fix (line-height/baseline), so it applies identically
 * whether the chip's content is one glyph (`/`) or two (`⌘K`).
 */
function SearchShortcutChip() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        lineHeight: 1,
        fontSize: '0.66rem',
        color: 'var(--fnt)',
        border: '1px solid var(--line)',
        borderRadius: 5,
        padding: 'var(--s-0-5) var(--s1-5)',
        margin: '-3px 0',
        background: 'var(--bg)',
      }}
    >
      <span aria-hidden="true">⌘</span>
      <span>K</span>
    </span>
  );
}

/**
 * The Search nav row (plan 024, command center): rendered through the SAME
 * shared `NavItem` component Library/Trash use, in its button mode (no
 * `href` — Search has no dedicated `/route` at all, it opens the floating
 * palette in place, exactly like the Settings item's `skipNavigate` case,
 * but simpler still since there's no `/search` URL to keep linkable
 * either). This used to be a hand-rolled `<button>` that duplicated
 * `NavItem`'s inline styles — that duplication drifted (e.g. its meta font
 * was 0.66rem vs. `NavItem`'s 0.72rem), which is why the row rendered at a
 * visibly different size/weight than Library/Trash despite looking
 * "close." Going through `NavItem` directly makes that drift structurally
 * impossible: icon size (18px, matching Library/Trash), label font/weight,
 * padding, and row height are all the ONE shared implementation. The `⌘K`
 * shortcut hint renders via `meta` (the same right-aligned slot
 * Library/Trash use for their counts) — `NavItem`'s `meta` accepts any
 * `ReactNode`, so the chip fits without a dedicated prop, and it lands in
 * the same right-hand column as the counts below it.
 */
function SidebarSearchItem({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <NavItem
      label="Search"
      icon={<SearchIcon size={18} stroke="currentColor" />}
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
 * Loading/empty/error states are handled calmly: counts simply omit their
 * meta content while loading (Library/Trash rows render with no number
 * rather than a placeholder); the Tags list renders `SidebarTags`' own
 * skeleton rows (matching a real tag `NavItem`'s footprint, see
 * `SidebarTags.tsx`) while `useTags()` is in flight, via `tagsLoading`
 * below — a genuinely empty tag list (once loaded) still shows the "Tags"
 * header + tools, just zero rows; a failed tags fetch renders nothing
 * (`tags` forced to `[]`) rather than crashing the sidebar.
 */
export const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(function Sidebar(
  { id, open = false, onNavigate = noop, onOpenSearch = noop },
  ref,
) {
  const navigate = useNavigate();
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
      <a
        href="/"
        onClick={onBrandClick}
        aria-label="silo home"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 9px 16px',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <GrainDot size={26} plate />
        <span style={{ fontWeight: 500, fontSize: 'var(--text-lg)', letterSpacing: '-0.015em' }}>
          silo
        </span>
      </a>

      <SidebarSearchItem onOpenSearch={onOpenSearch} />

      <NavItemLink
        to="/"
        end
        label="Library"
        meta={counts ? formatCount(counts.live) : undefined}
        icon={<LibraryIcon />}
        onNavigate={onNavigate}
      />
      <NavItemLink
        to="/trash"
        label="Trash"
        meta={counts ? formatCount(counts.trash) : undefined}
        icon={<TrashIcon />}
        onNavigate={onNavigate}
      />

      <SidebarDivider />

      <SidebarTags
        tags={tags}
        loading={tagsLoading}
        renderTagLink={(tag: TagCount) => (
          <NavItemLink
            key={tag.name}
            to={`/tags/${tag.name}`}
            // The `#` sits in NavItem's 18px icon slot (not inline in the
            // label) so it aligns to the SAME left ledger column as the
            // Library/Trash nav icons above and the `+ New tag` glyph below —
            // one clean column, matching shiori's Tags spacing. Dim (--ghost)
            // glyph, bright (--ink) label.
            icon={<span style={{ color: 'var(--ghost)', fontSize: 'var(--text-md)' }}>#</span>}
            label={tag.name}
            meta={tag.count > 0 ? formatCount(tag.count) : undefined}
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
