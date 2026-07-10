import { ModalHeader, ModalShell } from './ModalShell';
import { type SettingsTab, useSettings } from './SettingsContext';
import { AccessTab } from './SettingsTabs/AccessTab';
import { ImportExportTab } from './SettingsTabs/ImportExportTab';
import { PluginsTab } from './SettingsTabs/PluginsTab';
import { PreferencesTab } from './SettingsTabs/PreferencesTab';

const TABS: { key: SettingsTab; name: string }[] = [
  { key: 'plugins', name: 'Plugins' },
  { key: 'prefs', name: 'Preferences' },
  { key: 'import', name: 'Import / Export' },
  { key: 'access', name: 'API / MCP' },
];

/**
 * The underlined tab strip (redesign pass, matching
 * `docs/design/refs/settings-reference.png`'s tab treatment): a horizontal
 * row of plain-text tabs, the active one carrying a bottom-border indicator.
 * Uses `role="tablist"`/`aria-selected` (not the old segmented pills'
 * `aria-pressed`) since this is now a proper tab pattern, not a toggle
 * group. The indicator itself is a `::after` pseudo-element in `base.css`
 * (`.silo-settings-tab[aria-selected="true"]::after`) driven by
 * `aria-selected` so it can transition with a real CSS transition
 * (transform + opacity only) rather than snapping between tabs — and so it
 * automatically respects `prefers-reduced-motion` via the stylesheet's
 * blanket reduced-motion override, with no JS branch needed here.
 *
 * We deliberately DON'T set `aria-controls` on the tabs: only the active
 * tab's panel is ever in the DOM (`ActiveTabPanel` renders one at a time), so
 * an `aria-controls` on an inactive tab would reference an id that doesn't
 * exist at that moment (correctness review nit). The linkage runs the other
 * way instead — the single mounted panel carries `aria-labelledby` pointing
 * at the active tab, which always resolves.
 */
function SettingsTabStrip({
  tab,
  onSelect,
}: {
  tab: SettingsTab;
  onSelect: (t: SettingsTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      style={{
        display: 'flex',
        gap: 20,
        borderBottom: '1px solid var(--line)',
        marginBottom: 20,
        flexWrap: 'wrap',
      }}
    >
      {TABS.map((t) => {
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`settings-tab-${t.key}`}
            onClick={() => onSelect(t.key)}
            aria-selected={active}
            className="silo-settings-tab"
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

function ActiveTabPanel({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case 'plugins':
      return <PluginsTab />;
    case 'prefs':
      return <PreferencesTab />;
    case 'import':
      return <ImportExportTab />;
    case 'access':
      return <AccessTab />;
    default:
      return null;
  }
}

/**
 * The Settings modal (plan 011, V3-7; redesigned to match
 * `docs/design/refs/settings-reference.png`) — a 560px panel (scrolling
 * internally past `80vh`), radius 14, `rgba(24,17,7,.32)` scrim,
 * `siloFade`/`siloIn` entrances, focus-trap, Esc-to-close,
 * scrim-click-to-close — all via the shared `ModalShell`/`ModalHeader`
 * (extracted from this + `EditModal` once jscpd flagged the two panels'
 * near-identical shell code). Rendered once by `AppFrame` whenever
 * `useSettings().open` is true — same "single shared instance, provider owns
 * the open-state" shape as `RowMenuContext`/`EditModal`, so the sidebar's
 * Settings button and the `/settings` route both open the SAME modal rather
 * than each owning a copy.
 *
 * The header now also renders the reference's ✕ close icon
 * (`showCloseIcon`, alongside the existing `esc` chip — see `ModalHeader`'s
 * doc comment for why both stay), and the tab strip is the underlined
 * `role="tablist"` treatment (`SettingsTabStrip`) rather than the old
 * segmented pills.
 *
 * Each tab is its own component (`SettingsTabs/*.tsx`) purely to keep this
 * shell's cognitive complexity down — four tabs' worth of rows/copy in one
 * function would trip Biome's cognitive-complexity gate. Only `prefs` (the
 * Theme control) is wired to a real backend (the existing theme system);
 * `import`/`access` render v3's controls faithfully but disabled (Access's
 * hero "Copy config" action is the one exception — a genuinely live,
 * client-side clipboard convenience), and `plugins` is parked behind the
 * plugin system — see each tab file's doc comment for the specific stub
 * rationale.
 */
export function SettingsModal() {
  const { tab, setTab, closeSettings } = useSettings();

  return (
    <ModalShell width={560} maxHeight="80vh" ariaLabel="Settings" onClose={closeSettings}>
      <ModalHeader title="Settings" onClose={closeSettings} showCloseIcon />
      <SettingsTabStrip tab={tab} onSelect={setTab} />
      <div role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        <ActiveTabPanel tab={tab} />
      </div>
    </ModalShell>
  );
}
