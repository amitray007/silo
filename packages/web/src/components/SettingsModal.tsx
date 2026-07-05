import { ModalHeader, ModalShell } from './ModalShell';
import { type SettingsTab, useSettings } from './SettingsContext';
import { AccessTab } from './SettingsTabs/AccessTab';
import { ImportExportTab } from './SettingsTabs/ImportExportTab';
import { PluginsTab } from './SettingsTabs/PluginsTab';
import { PreferencesTab } from './SettingsTabs/PreferencesTab';

const TABS: { key: SettingsTab; name: string }[] = [
  { key: 'plugins', name: 'Plugins' },
  { key: 'prefs', name: 'Preferences' },
  { key: 'import', name: 'Import/Export' },
  { key: 'access', name: 'Access' },
];

/** The segmented-pill tab strip (v3's `tabs` — one shared `sc-for`, `Silo-v3.html:314-318`). Active tab is ink-on-`--bg` with the raised shadow; inactive is ghost text on transparent — never amber, matching every other segmented control in the app. */
function SettingsTabStrip({
  tab,
  onSelect,
}: {
  tab: SettingsTab;
  onSelect: (t: SettingsTab) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 5,
        marginBottom: 16,
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        padding: 3,
        width: 'max-content',
        maxWidth: '100%',
        flexWrap: 'wrap',
      }}
    >
      {TABS.map((t) => {
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            aria-pressed={active}
            style={{
              border: 0,
              fontFamily: 'inherit',
              fontSize: '0.76rem',
              fontWeight: 500,
              padding: '4px 13px',
              borderRadius: 999,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              color: active ? 'var(--ink)' : 'var(--ghost)',
              background: active ? 'var(--bg)' : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(20,12,4,.08)' : 'none',
            }}
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
 * The Settings modal (plan 011, V3-7) — matches `Silo-v3.html`'s
 * `settingsOpen` block: 560px panel (scrolling internally past `80vh`),
 * radius 14, `rgba(24,17,7,.32)` scrim, `siloFade`/`siloIn` entrances,
 * focus-trap, Esc-to-close, scrim-click-to-close — all via the shared
 * `ModalShell`/`ModalHeader` (extracted from this + `EditModal` once jscpd
 * flagged the two panels' near-identical shell code). Rendered once by
 * `AppFrame` whenever `useSettings().open` is true — same "single shared
 * instance, provider owns the open-state" shape as `RowMenuContext`/
 * `EditModal`, so the sidebar's Settings button and the `/settings` route
 * both open the SAME modal rather than each owning a copy.
 *
 * Each tab is its own component (`SettingsTabs/*.tsx`) purely to keep this
 * shell's cognitive complexity down — four tabs' worth of rows/copy in one
 * function would trip Biome's cognitive-complexity gate. Only `prefs` (the
 * Theme control) is wired to a real backend (the existing theme system);
 * `import`/`access` render v3's controls faithfully but disabled, and
 * `plugins` is parked behind the plugin system — see each tab file's doc
 * comment for the specific stub rationale.
 */
export function SettingsModal() {
  const { tab, setTab, closeSettings } = useSettings();

  return (
    <ModalShell width={560} maxHeight="80vh" ariaLabel="Settings" onClose={closeSettings}>
      <ModalHeader title="Settings" onClose={closeSettings} />
      <SettingsTabStrip tab={tab} onSelect={setTab} />
      <ActiveTabPanel tab={tab} />
    </ModalShell>
  );
}
