import { useEffect, useRef } from 'react';
import { ContentHeader } from './ContentHeader';
import { ReaderIcon } from './reader/ReaderIcon';
import { SETTINGS_TABS, type SettingsTab, useSettings } from './SettingsContext';
import { AccessTab } from './SettingsTabs/AccessTab';
import { ImportExportTab } from './SettingsTabs/ImportExportTab';
import { PluginsTab } from './SettingsTabs/PluginsTab';
import { PreferencesTab } from './SettingsTabs/PreferencesTab';

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

export function SettingsPage() {
  const { tab, setTab, closeSettings } = useSettings();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [data-reader-menu]')
      )
        return;
      event.preventDefault();
      closeSettings();
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [closeSettings]);
  return (
    <section className="silo-three-pane silo-settings-page" aria-label="Settings">
      <aside className="silo-listpane silo-settings-navigation">
        <ContentHeader title="Settings">
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Close settings"
            title="Return to links"
            onClick={closeSettings}
          >
            <ReaderIcon name="close" />
          </button>
        </ContentHeader>
        <div
          className="silo-settings-route-tabs"
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
        >
          {SETTINGS_TABS.map((entry, index) => (
            <button
              type="button"
              role="tab"
              className="silo-nav-item"
              key={entry.key}
              id={`settings-tab-${entry.key}`}
              aria-controls={`settings-panel-${tab}`}
              aria-selected={entry.key === tab}
              data-active={entry.key === tab}
              tabIndex={entry.key === tab ? 0 : -1}
              onClick={() => setTab(entry.key)}
              onKeyDown={(event) => {
                if (
                  !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const delta = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
                let next = (index + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = SETTINGS_TABS.length - 1;
                const target = SETTINGS_TABS[next];
                if (target) {
                  setTab(target.key);
                  document.getElementById(`settings-tab-${target.key}`)?.focus();
                }
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </aside>
      <section className="silo-settings-main">
        <header className="silo-panehead">
          <h2 ref={heading} tabIndex={-1}>
            {SETTINGS_TABS.find((entry) => entry.key === tab)?.name}
          </h2>
        </header>
        <div className="silo-settings-scroll">
          <div
            className="silo-settings-route-panel"
            id={`settings-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
          >
            <ActiveTabPanel tab={tab} />
          </div>
        </div>
      </section>
    </section>
  );
}
