import { useId, useState } from 'react';
import { useAi, useSettings, useUpdateSettings } from '../../api/hooks';
import type { SettingsMap } from '../../api/types';
import type { PluginSource, PluginsMap } from '../../lib/pluginSettings';
import { setPluginField } from '../../lib/pluginSettings';
import { type LogoSource, PluginLogo } from './PluginLogo';
import { ToggleSwitch } from './ToggleSwitch';

// Render defaults while loading; all settings switches stay disabled.
const LOADING_PLUGINS: PluginsMap = {
  hacker_news: { enabled: true, inline: true, hover: true, palette: true },
  github: { enabled: true, hover: true, palette: true },
  youtube: { enabled: true, hover: true, palette: true },
  twitter: { enabled: true, inline: true, hover: true, palette: true },
};

const PLUGIN_SOURCES = [
  { key: 'hacker_news', name: 'Hacker News' },
  { key: 'github', name: 'GitHub' },
  { key: 'youtube', name: 'YouTube' },
  { key: 'twitter', name: 'Twitter / X' },
] as const satisfies ReadonlyArray<{ key: PluginSource; name: string }>;

// Only show surfaces supported by each source.
const FEATURE_ROWS_BY_SOURCE: Record<
  PluginSource,
  ReadonlyArray<{ field: 'inline' | 'hover' | 'palette'; name: string; desc: string }>
> = {
  hacker_news: [
    {
      field: 'inline',
      name: 'Inline on the row',
      desc: 'Points and comments shown directly in the list',
    },
    {
      field: 'hover',
      name: 'On hover (preview card)',
      desc: 'Points and comments in the hover preview',
    },
    {
      field: 'palette',
      name: 'In the command palette',
      desc: 'Hover card + inline points/comments in the ⌘K palette',
    },
  ],
  github: [
    {
      field: 'hover',
      name: 'On hover (preview card)',
      desc: 'Stars, forks, and issues in the hover preview',
    },
    {
      field: 'palette',
      name: 'In the command palette',
      desc: 'Hover card in the ⌘K palette',
    },
  ],
  youtube: [
    {
      field: 'hover',
      name: 'On hover (preview card)',
      desc: 'Thumbnail and channel in the hover preview',
    },
    {
      field: 'palette',
      name: 'In the command palette',
      desc: 'Hover card in the ⌘K palette',
    },
  ],
  twitter: [
    {
      field: 'inline',
      name: 'Inline on the row',
      desc: 'Author and tweet text shown directly in the list',
    },
    {
      field: 'hover',
      name: 'On hover (preview card)',
      desc: 'Author, text, and engagement in the hover preview',
    },
    {
      field: 'palette',
      name: 'In the command palette',
      desc: 'Hover card + inline tweet text in the ⌘K palette',
    },
  ],
};

const SURFACE_LABELS = { inline: 'Row', hover: 'hover card', palette: '⌘K' };

function sourceSummary(source: PluginSource, plugins: PluginsMap): string {
  const state = plugins[source];
  if (!state.enabled) return 'Off';
  const list = FEATURE_ROWS_BY_SOURCE[source]
    .filter(({ field }) => state[field as keyof typeof state])
    .map(({ field }) => SURFACE_LABELS[field])
    .join(', ');
  // Sentence case: "Hover card, ⌘K" when the row surface is off.
  return list ? list.charAt(0).toUpperCase() + list.slice(1) : 'No surfaces on';
}

function FeatureToggleRow({
  name,
  desc,
  on,
  masterEnabled,
  loading,
  onToggle,
}: {
  name: string;
  desc: string;
  on: boolean;
  masterEnabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const disabled = !masterEnabled || loading;
  return (
    <div className="silo-plugin-feature" data-disabled={disabled}>
      <div className="silo-plugin-copy">
        <div className="silo-plugin-label">{name}</div>
        <div className="silo-plugin-description">{desc}</div>
      </div>
      <ToggleSwitch on={on} disabled={disabled} onToggle={onToggle} label={name} />
    </div>
  );
}

const AI_HINT = 'Turn on AI in the AI tab';

/**
 * The plugin-placed AI features (`GET /api/ai` -> `features[].plugin`). The
 * toggle is off-limits until AI is ready; the hint then replaces the description.
 */
function AiFeatureRows({
  source,
  sourceEnabled,
  settings,
  updateSettings,
}: {
  source: PluginSource;
  sourceEnabled: boolean;
  settings: SettingsMap | undefined;
  updateSettings: ReturnType<typeof useUpdateSettings>;
}) {
  const { data: ai } = useAi();
  const features = (ai?.features ?? []).filter((feature) => feature.plugin === source);
  const settingsAi = settings?.ai;
  const ready = ai?.status?.ready === true;
  return features.map((feature) => {
    const on = settingsAi?.features[feature.id as keyof typeof settingsAi.features] === true;
    return (
      <FeatureToggleRow
        key={feature.id}
        name={feature.label}
        desc={ready ? feature.description : AI_HINT}
        on={on}
        masterEnabled={sourceEnabled && ready}
        loading={!settingsAi || updateSettings.isPending}
        onToggle={() =>
          settingsAi &&
          updateSettings.mutate({
            ai: { ...settingsAi, features: { ...settingsAi.features, [feature.id]: !on } },
          })
        }
      />
    );
  });
}

function SiloSettingsSection({
  settings,
  updateSettings,
}: {
  settings: SettingsMap | undefined;
  updateSettings: ReturnType<typeof useUpdateSettings>;
}) {
  const hoverPreview = settings?.hoverPreview ?? false;
  const linkPreviewImages = settings?.linkPreviewImages ?? true;
  const disabled = !settings || updateSettings.isPending;

  return (
    <>
      <h3 className="silo-plugin-section-label">Silo</h3>
      <div className="silo-plugin-silo-row">
        <div className="silo-plugin-copy">
          <div className="silo-plugin-label">Hover previews</div>
          <div className="silo-plugin-description">Show a preview card when you hover a link.</div>
        </div>
        <ToggleSwitch
          on={hoverPreview}
          disabled={disabled}
          onToggle={() => updateSettings.mutate({ hoverPreview: !hoverPreview })}
          label="Hover previews"
        />
      </div>
      <div className="silo-plugin-silo-row" data-disabled={!hoverPreview || disabled}>
        <div className="silo-plugin-copy">
          <div className="silo-plugin-label">Link preview images</div>
          <div className="silo-plugin-description">
            Show a page's preview image in the hover card.
          </div>
        </div>
        <ToggleSwitch
          on={linkPreviewImages}
          disabled={!hoverPreview || disabled}
          onToggle={() => updateSettings.mutate({ linkPreviewImages: !linkPreviewImages })}
          label="Link preview images"
        />
      </div>
    </>
  );
}

// Keep feature choices when disabling a source; writes replace the full plugins map.
export function PluginsTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const plugins = settings?.plugins ?? LOADING_PLUGINS;
  const loading = !settings;

  const [selected, setSelected] = useState<LogoSource | null>(null);
  const panelId = useId();

  function writeField<S extends PluginSource>(
    sourceKey: S,
    field: keyof PluginsMap[S],
    value: boolean,
  ): void {
    updateSettings.mutate({ plugins: setPluginField(plugins, sourceKey, field, value) });
  }

  return (
    <>
      <h3 className="silo-plugin-section-label">Sources</h3>
      <div className="silo-plugin-sources">
        {PLUGIN_SOURCES.map((source) => {
          const state = plugins[source.key];
          const expanded = selected === source.key;
          const sourcePanelId = `${panelId}-${source.key}`;
          const toggleExpanded = () => setSelected(expanded ? null : source.key);
          return (
            <div key={source.key} className="silo-plugin-source">
              <div className="silo-plugin-source-row">
                <button
                  type="button"
                  className="silo-plugin-body"
                  onClick={toggleExpanded}
                  aria-label={source.name}
                  aria-describedby={`${sourcePanelId}-summary`}
                  aria-expanded={expanded}
                  aria-controls={sourcePanelId}
                >
                  <PluginLogo source={source.key} />
                  <span className="silo-plugin-copy">
                    <span className="silo-plugin-name">{source.name}</span>
                    <span id={`${sourcePanelId}-summary`} className="silo-plugin-summary">
                      {sourceSummary(source.key, plugins)}
                    </span>
                  </span>
                </button>
                <ToggleSwitch
                  on={state.enabled}
                  disabled={loading}
                  onToggle={() => writeField(source.key, 'enabled', !state.enabled)}
                  label={source.name}
                />
                <button
                  type="button"
                  className="silo-plugin-disclosure"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${source.name} features`}
                  aria-expanded={expanded}
                  aria-controls={sourcePanelId}
                  onClick={toggleExpanded}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <title>Disclosure</title>
                    <path d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
                  </svg>
                </button>
              </div>
              <div id={sourcePanelId} hidden={!expanded} className="silo-plugin-features">
                {expanded &&
                  FEATURE_ROWS_BY_SOURCE[source.key].map((row) => (
                    <FeatureToggleRow
                      key={row.field}
                      name={row.name}
                      desc={row.desc}
                      on={state[row.field as keyof typeof state] as boolean}
                      masterEnabled={state.enabled}
                      loading={loading}
                      onToggle={() =>
                        writeField(
                          source.key,
                          row.field as keyof PluginsMap[typeof source.key],
                          !state[row.field as keyof typeof state],
                        )
                      }
                    />
                  ))}
                {expanded && (
                  <AiFeatureRows
                    source={source.key}
                    sourceEnabled={state.enabled}
                    settings={settings}
                    updateSettings={updateSettings}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <SiloSettingsSection settings={settings} updateSettings={updateSettings} />
    </>
  );
}
