import type { MouseEvent } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useCounts, useTags } from '../api/hooks';
import { ThemeToggle } from '../theme/ThemeToggle';
import { GrainDot } from './GrainDot';
import { NavItem } from './NavItem';
import { SidebarSection } from './SidebarSection';

/**
 * A `NavItem` wired to react-router: `useMatch` computes whether the current
 * location matches `to` (mirroring `NavLink`'s own `end`-aware matching) and
 * drives `NavItem`'s `active` prop; a client-side `navigate` on click keeps
 * routing in react-router's hands. We deliberately DON'T wrap `NavItem` in a
 * `<NavLink>` — that would nest two `<a>` elements (invalid HTML, and it
 * breaks `aria-current`/role queries onto the wrong anchor), so `NavItem`'s
 * own anchor stays the single, real link.
 */
function NavItemLink({
  to,
  label,
  meta,
  end = false,
}: {
  to: string;
  label: string;
  meta?: React.ReactNode;
  end?: boolean;
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
  };

  return <NavItem label={label} meta={meta} active={active} href={to} onClick={onClick} />;
}

/**
 * The real, data-bound sidebar (`docs/design/app/library-sidebar-light.png`):
 * brand row, Library (live count), Trash (`count · purgeWindowDays`), a Tags
 * section built from `useTags()` (count-desc order preserved as returned by
 * the API), and Settings pinned to the bottom via flex (the Tags section
 * grows to fill available space).
 *
 * Loading/empty/error states are handled calmly: while counts/tags are
 * loading we simply omit the meta/section content (no layout-shifting
 * skeleton chrome); an empty tag list renders no Tags section at all; a
 * failed tags fetch renders nothing rather than crashing the sidebar.
 */
export function Sidebar() {
  const { data: counts } = useCounts();
  const { data: tagsData, isError: tagsErrored } = useTags();

  const tags = tagsErrored ? [] : (tagsData?.tags ?? []);

  return (
    <nav
      aria-label="Sidebar"
      style={{
        width: 210,
        flex: 'none',
        background: 'var(--bg2)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '16px 13px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 9px 16px' }}>
        <GrainDot />
        <span style={{ fontWeight: 500, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>silo</span>
      </div>

      <NavItemLink to="/" end label="Library" meta={counts?.live} />
      <NavItemLink
        to="/trash"
        label="Trash"
        meta={counts ? `${counts.trash} · ${counts.purgeWindowDays}d` : undefined}
      />

      {tags.length > 0 && (
        <SidebarSection label="Tags">
          {tags.map((tag) => (
            <NavItemLink
              key={tag.name}
              to={`/tags/${tag.name}`}
              label={`#${tag.name}`}
              meta={tag.count}
            />
          ))}
        </SidebarSection>
      )}

      <span style={{ flex: 1 }} />

      <div style={{ padding: '4px 10px 8px' }}>
        <ThemeToggle />
      </div>
      <NavItemLink to="/settings" label="Settings" />
    </nav>
  );
}
