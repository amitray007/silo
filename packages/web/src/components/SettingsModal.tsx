import { ModalHeader, ModalShell } from './ModalShell';
import { type SettingsTab, useSettings } from './SettingsContext';
import { AccessTab } from './SettingsTabs/AccessTab';
import { ImportExportTab } from './SettingsTabs/ImportExportTab';
import { PluginsTab } from './SettingsTabs/PluginsTab';
import { PreferencesTab } from './SettingsTabs/PreferencesTab';

const TABS: { key: SettingsTab; name: string }[] = [
  { key: 'plugins', name: 'Plugins' },
  { key: 'prefs', name: 'Preferences' },
  { key: 'import', name: 'Import & export' },
  { key: 'access', name: 'Access' },
];

function SettingsTabStrip({
  tab,
  onSelect,
}: {
  tab: SettingsTab;
  onSelect: (t: SettingsTab) => void;
}) {
  return (
    <div role="tablist" aria-label="Settings sections" className="silo-settings-tabs">
      <span className="silo-settings-nav-title">Settings</span>
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

const TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  plugins: 'Choose the details silo captures and shows for each source.',
  prefs: 'How silo looks and how long it keeps things.',
  import: 'Move your library in and out.',
  access: 'Connect agents and other tools to silo.',
};

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

export function SettingsModal() {
  const { tab, setTab, closeSettings } = useSettings();

  return (
    <ModalShell
      width={780}
      maxHeight="min(560px, 100%)"
      ariaLabel="Settings"
      onClose={closeSettings}
      variant="settings"
    >
      <ModalHeader title="Settings" onClose={closeSettings} showCloseIcon />
      <SettingsTabStrip tab={tab} onSelect={setTab} />
      <div className="silo-settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        <h3>{TABS.find((entry) => entry.key === tab)?.name}</h3>
        <p className="silo-settings-lead">{TAB_DESCRIPTIONS[tab]}</p>
        <ActiveTabPanel tab={tab} />
      </div>
    </ModalShell>
  );
}
