import { Chip, ComingSoon, GrainDot, Mark, NavItem, SidebarSection } from './components';
import { ThemeToggle } from './theme/ThemeToggle';

/**
 * Placeholder app frame + a small gallery of the W3 Oat primitives. The real
 * sidebar/frame/routing lands in W5; this proves the primitives render
 * against the live tokens/themes (and keeps them "used" for knip) until then.
 */
export function App() {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <GrainDot />
          <span style={{ fontWeight: 500, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>
            silo
          </span>
        </div>
        <ThemeToggle />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          padding: '0 20px 24px',
          maxWidth: 320,
        }}
      >
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <NavItem label="Library" meta={12} active href="#library" />
          <NavItem label="Trash" meta="3 · 30d" href="#trash" />
          <SidebarSection label="Tags">
            <NavItem label="#mcp" meta={4} href="#tags/mcp" />
            <NavItem label="#essays" meta={2} href="#tags/essays" />
          </SidebarSection>
        </section>

        <section style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Chip domain="modelcontextprotocol.io" />
          <Chip domain="tbray.org" />
          <Chip domain={undefined} />
        </section>

        <section style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Mark kind="note" />
          <Mark kind="claude" />
          <Mark kind="enriching" />
          <Mark kind="degraded" />
        </section>

        <section style={{ border: '1px solid var(--line)', borderRadius: 10 }}>
          <ComingSoon title="Nothing kept yet." subtitle="This view is coming soon." />
        </section>
      </div>
    </div>
  );
}
