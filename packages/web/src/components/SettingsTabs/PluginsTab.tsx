import { type CSSProperties, useId, useState } from 'react';
import { useSettings, useUpdateSettings } from '../../api/hooks';
import type { SettingsMap } from '../../api/types';
import type { PluginSource, PluginsMap } from '../../lib/pluginSettings';
import { setPluginField } from '../../lib/pluginSettings';
import { type LogoSource, PluginLogo } from './PluginLogo';
import { rowDesc, rowLabel } from './rowStyles';
import { ToggleSwitch } from './ToggleSwitch';

/**
 * The all-on shape used while `useSettings()` is still loading (plan 026 —
 * previously each row read `plugins?.[key] ?? true`; now the whole grid/panel
 * needs a full object up front to render feature rows, so this stands in as
 * that "optimistic" default until the real value arrives, matching the prior
 * `?? true` optimism field-for-field).
 */
const LOADING_PLUGINS: PluginsMap = {
  hacker_news: { enabled: true, inline: true, hover: true, palette: true },
  github: { enabled: true, hover: true, palette: true },
  youtube: { enabled: true, hover: true, palette: true },
  twitter: { enabled: true, inline: true, hover: true, palette: true },
};

/**
 * Grid metadata for the four toggleable sources — mirrors
 * `@silo/core`'s `settingsSchema.plugins` allowlist EXACTLY (`link` excluded:
 * it has no enricher/card to toggle — see `packages/core/src/settings/
 * schema.ts`'s doc comment). `twitter` joined the real allowlist in plan 026
 * (previously a static "Soon" card) and now has a live worker enricher too
 * (`api.fxtwitter.com`) alongside the `silo ingest x` CLI path — `enabled`
 * gates the worker fetch, `inline`/`hover` gate its two render surfaces,
 * mirroring `hacker_news`. `key` indexes directly into `SettingsMap['plugins']`.
 */
const PLUGIN_SOURCES = [
  { key: 'hacker_news', name: 'Hacker News' },
  { key: 'github', name: 'GitHub' },
  { key: 'youtube', name: 'YouTube' },
  { key: 'twitter', name: 'Twitter / X' },
] as const satisfies ReadonlyArray<{ key: PluginSource; name: string }>;

/** The feature toggles a given source supports — HN and Twitter render both an inline row line and a hover preview; GitHub/YouTube are hover-only (see `packages/core/src/settings/schema.ts`'s doc comment). Keyed so the panel only ever shows toggles the source's schema actually has. */
const FEATURE_ROWS_BY_SOURCE: Record<
  PluginSource,
  ReadonlyArray<{ field: 'inline' | 'hover'; name: string; desc: string }>
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
  ],
  github: [
    {
      field: 'hover',
      name: 'On hover (preview card)',
      desc: 'Stars, forks, and issues in the hover preview',
    },
  ],
  youtube: [
    {
      field: 'hover',
      name: 'On hover (preview card)',
      desc: 'Thumbnail and channel in the hover preview',
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
  ],
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
  gap: 10,
  marginBottom: 4,
};

const cardBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '16px 8px 12px',
  borderRadius: 12,
  border: '1px solid var(--line)',
  background: 'var(--bg2)',
  cursor: 'pointer',
  transition: 'border-color .15s ease, box-shadow .15s ease',
  font: 'inherit',
  color: 'inherit',
};

const cardTitle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  color: 'var(--ink)',
};

const panelShell: CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--line)',
  padding: '16px 18px',
  marginTop: 4,
};

const panelHeaderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const panelDivider: CSSProperties = {
  border: 'none',
  borderTop: '1px solid var(--line)',
  margin: '14px 0',
};

const featureRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '10px 0',
};

/** The grid card's status dot — a smaller, non-interactive readout of `enabled` (the card itself is the click target, selecting the source; the actual toggle lives in the expand panel). */
function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: on ? 'var(--mark)' : 'transparent',
        border: `1px solid ${on ? 'var(--mark)' : 'var(--ghost)'}`,
        boxSizing: 'border-box',
      }}
    />
  );
}

function SourceCard({
  logoSource,
  name,
  selected,
  panelId,
  on,
  onSelect,
}: {
  logoSource: LogoSource;
  name: string;
  selected: boolean;
  panelId: string;
  on: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={selected}
      aria-controls={panelId}
      style={{
        ...cardBase,
        borderColor: selected ? 'var(--mark)' : 'var(--line)',
        boxShadow: selected ? '0 0 0 1px var(--mark)' : 'none',
      }}
    >
      <PluginLogo source={logoSource} size={44} />
      <span style={cardTitle}>{name}</span>
      <StatusDot on={on} />
    </button>
  );
}

function FeatureToggleRow({
  field,
  name,
  desc,
  on,
  masterEnabled,
  loading,
  onToggle,
}: {
  field: string;
  name: string;
  desc: string;
  on: boolean;
  masterEnabled: boolean;
  // Disabled while settings are still loading (plan 026 review fix): during
  // the initial GET the whole tab renders against the all-on LOADING_PLUGINS
  // placeholder, so a click here would rebuild the PATCH from placeholder
  // values and clobber the user's real stored settings. The master toggle
  // already gates on `loading`; the feature rows must too (the pre-026 UI
  // disabled every toggle until settings loaded — dropped for feature rows in
  // the redesign, re-added here).
  loading: boolean;
  onToggle: () => void;
}) {
  const disabled = !masterEnabled || loading;
  return (
    <div key={field} style={featureRow}>
      <div style={{ flex: 1, opacity: disabled ? 0.5 : 1 }}>
        <div style={rowLabel}>{name}</div>
        <div style={rowDesc}>{desc}</div>
      </div>
      <ToggleSwitch on={on} disabled={disabled} onToggle={onToggle} label={name} />
    </div>
  );
}

/**
 * The "silo" section — silo's OWN behaviors, distinct from the source
 * plugins above (those gate ingestion/rendering of external sources; this
 * gates silo's own UI behavior). Sits below the source-plugin grid+panel,
 * separated by a divider. Currently one row (`Link preview images`,
 * `SettingsMap['linkPreviewImages']` — see `packages/core/src/settings/
 * schema.ts`'s doc comment); written as its own component so a future
 * silo-level toggle is just another row here, not a restructure of
 * `PluginsTab`'s already-nontrivial cognitive complexity.
 *
 * Mirrors `AccessTab`'s live MCP-access toggle pattern exactly: read
 * `settings?.linkPreviewImages ?? true` (default-on, matching the app's
 * loading optimism elsewhere), disable while `settings` is still loading OR
 * the mutation is in flight (`updateSettings.isPending`) so a slow PATCH
 * can't be double-fired.
 */
function SiloSettingsSection({
  settings,
  updateSettings,
}: {
  settings: SettingsMap | undefined;
  updateSettings: ReturnType<typeof useUpdateSettings>;
}) {
  const linkPreviewImages = settings?.linkPreviewImages ?? true;
  const disabled = !settings || updateSettings.isPending;

  return (
    <>
      <hr style={panelDivider} />
      <div style={featureRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Link preview images</div>
          <div style={rowDesc}>Show a page's preview image in the hover card.</div>
        </div>
        <ToggleSwitch
          on={linkPreviewImages}
          disabled={disabled}
          onToggle={() => updateSettings.mutate({ linkPreviewImages: !linkPreviewImages })}
          label="Link preview images"
        />
      </div>
    </>
  );
}

/**
 * Settings → Plugins (plan 026 redesign; Twitter un-parked from its static
 * "Soon" card into a real toggle) — a 4-up logo grid (HN/GitHub/YouTube/
 * Twitter-X) that expands inline below into a control panel for whichever
 * source is selected. Replaces the flat toggle-row list (plan 016) now that
 * each source has a **master `enabled`** plus the per-feature `inline`/
 * `hover` flags it supports (`SettingsMap['plugins']`, plan 026 schema —
 * see `packages/core/src/settings/schema.ts`'s doc comment).
 *
 * The master toggle flips `.enabled`; feature toggles flip `.inline`/`.hover`
 * and are greyed + disabled while `.enabled` is off (the plan's rule — a
 * disabled source's feature choices are PRESERVED, not reset, so re-enabling
 * restores them; see `setPluginField`'s doc comment). Every write goes
 * through `setPluginField`, which reconstructs the FULL four-source object
 * (`core.setSetting('plugins', ...)` replaces the whole stored value, no
 * sub-key merge).
 *
 * All four sources render through the same generic grid/panel — the UI
 * doesn't need to special-case which fields a source supports; it renders
 * whatever `FEATURE_ROWS_BY_SOURCE[source.key]` lists through the same
 * `setPluginField` path.
 */
export function PluginsTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const plugins = settings?.plugins ?? LOADING_PLUGINS;
  const loading = !settings;

  const [selected, setSelected] = useState<LogoSource>('hacker_news');
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
      <div style={gridStyle}>
        {PLUGIN_SOURCES.map((source) => (
          <SourceCard
            key={source.key}
            logoSource={source.key}
            name={source.name}
            selected={selected === source.key}
            panelId={panelId}
            on={plugins[source.key].enabled}
            onSelect={() => setSelected(source.key)}
          />
        ))}
      </div>

      <div id={panelId} style={panelShell}>
        {(() => {
          const source = PLUGIN_SOURCES.find((s) => s.key === selected);
          if (!source) return null;
          const state = plugins[source.key];
          return (
            <>
              <div style={panelHeaderRow}>
                <PluginLogo source={source.key} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={rowLabel}>{source.name}</div>
                </div>
                <ToggleSwitch
                  on={state.enabled}
                  disabled={loading}
                  onToggle={() => writeField(source.key, 'enabled', !state.enabled)}
                  label={source.name}
                />
              </div>
              <hr style={panelDivider} />
              {FEATURE_ROWS_BY_SOURCE[source.key].map((row) => (
                <FeatureToggleRow
                  key={row.field}
                  field={row.field}
                  name={row.name}
                  desc={row.desc}
                  on={state[row.field as keyof typeof state] as boolean}
                  masterEnabled={state.enabled}
                  loading={loading}
                  onToggle={() =>
                    // `row` was drawn from `FEATURE_ROWS_BY_SOURCE[source.key]`, so `row.field`
                    // is guaranteed to be a field `source.key`'s schema actually has — the
                    // union-vs-generic correlation TS can't see through `.find()`'s narrowing.
                    writeField(
                      source.key,
                      row.field as keyof PluginsMap[typeof source.key],
                      !state[row.field as keyof typeof state],
                    )
                  }
                />
              ))}
            </>
          );
        })()}
      </div>

      <SiloSettingsSection settings={settings} updateSettings={updateSettings} />
    </>
  );
}
