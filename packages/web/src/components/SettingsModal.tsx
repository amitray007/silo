import { lazy, Suspense } from 'react';
import { ModalHeader, ModalShell } from './ModalShell';
import { type SettingsTab, useSettings } from './SettingsContext';

const AccessTab = lazy(() =>
  import('./SettingsTabs/AccessTab').then((module) => ({ default: module.AccessTab })),
);
const AiTab = lazy(() =>
  import('./SettingsTabs/AiTab').then((module) => ({ default: module.AiTab })),
);
const ImportExportTab = lazy(() =>
  import('./SettingsTabs/ImportExportTab').then((module) => ({ default: module.ImportExportTab })),
);
const PluginsTab = lazy(() =>
  import('./SettingsTabs/PluginsTab').then((module) => ({ default: module.PluginsTab })),
);
const PreferencesTab = lazy(() =>
  import('./SettingsTabs/PreferencesTab').then((module) => ({ default: module.PreferencesTab })),
);
const ReaderTab = lazy(() =>
  import('./SettingsTabs/ReaderTab').then((module) => ({ default: module.ReaderTab })),
);

const TABS: { key: SettingsTab; name: string }[] = [
  { key: 'plugins', name: 'Plugins' },
  { key: 'ai', name: 'AI' },
  { key: 'prefs', name: 'Preferences' },
  { key: 'reader', name: 'Reader' },
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
      {TABS.map((t, index) => {
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`settings-tab-${t.key}`}
            onClick={() => onSelect(t.key)}
            aria-selected={active}
            aria-controls={`settings-panel-${tab}`}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => {
              if (
                !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              const delta = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
              let next = (index + delta + TABS.length) % TABS.length;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = TABS.length - 1;
              const target = TABS[next];
              if (target) {
                onSelect(target.key);
                document.getElementById(`settings-tab-${target.key}`)?.focus();
              }
            }}
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
  ai: 'Optional AI features, using your own provider key.',
  prefs: 'How silo looks and how long it keeps things.',
  reader: 'How articles look and sound, on every device.',
  import: 'Move your library in and out.',
  access: 'Connect agents and other tools to silo.',
};

function ActiveTabPanel({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case 'plugins':
      return <PluginsTab />;
    case 'ai':
      return <AiTab />;
    case 'prefs':
      return <PreferencesTab />;
    case 'reader':
      return <ReaderTab />;
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
      <div
        id={`settings-panel-${tab}`}
        className="silo-settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
      >
        <h3>{TABS.find((entry) => entry.key === tab)?.name}</h3>
        <p className="silo-settings-lead">{TAB_DESCRIPTIONS[tab]}</p>
        <Suspense fallback={<p role="status">Loading settings…</p>}>
          <ActiveTabPanel tab={tab} />
        </Suspense>
      </div>
    </ModalShell>
  );
}
