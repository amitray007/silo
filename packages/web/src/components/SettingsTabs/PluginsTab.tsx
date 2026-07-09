import { type CSSProperties, useId, useState } from 'react';
import { useSettings, useUpdateSettings } from '../../api/hooks';
import type { PluginSource, PluginsMap } from '../../lib/pluginSettings';
import { setPluginField } from '../../lib/pluginSettings';
import { type LogoSource, PluginLogo } from './PluginLogo';
import { badgeChip, rowDesc, rowLabel, tabNote } from './rowStyles';

/**
 * The all-on shape used while `useSettings()` is still loading (plan 026 —
 * previously each row read `plugins?.[key] ?? true`; now the whole grid/panel
 * needs a full object up front to render feature rows, so this stands in as
 * that "optimistic" default until the real value arrives, matching the prior
 * `?? true` optimism field-for-field).
 */
const LOADING_PLUGINS: PluginsMap = {
  hacker_news: { enabled: true, inline: true, hover: true },
  github: { enabled: true, hover: true },
  youtube: { enabled: true, hover: true },
};

/**
 * Grid metadata for the three toggleable sources — mirrors
 * `@silo/core`'s `settingsSchema.plugins` allowlist EXACTLY (`link`/`twitter`
 * excluded: `link` has no enricher to toggle, `twitter`'s rich data comes
 * from the page itself, not an external-API enricher — see
 * `packages/core/src/settings/schema.ts`'s doc comment). `key` indexes
 * directly into `SettingsMap['plugins']`.
 */
const PLUGIN_SOURCES = [
  { key: 'hacker_news', name: 'Hacker News' },
  { key: 'github', name: 'GitHub' },
  { key: 'youtube', name: 'YouTube' },
] as const satisfies ReadonlyArray<{ key: PluginSource; name: string }>;

/** The feature toggles a given source supports — HN renders both an inline row line and a hover preview; GitHub/YouTube are hover-only today (see `packages/core/src/settings/schema.ts`'s doc comment). Keyed so the panel only ever shows toggles the source's schema actually has. */
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

/**
 * The shared amber-dot toggle (plan 016's original control, extracted here
 * plan 026 since it's now used in both the panel's master/feature rows AND —
 * via the status dot below — the grid card). `disabled` greys it out AND
 * blocks the click (used for feature rows when the source's master `enabled`
 * is off, per the plan's "feature toggles are disabled/greyed when master is
 * off" rule).
 */
function PluginToggle({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={
        disabled
          ? `${label} — turn the source on first`
          : on
            ? `${label} is on — click to turn off`
            : `${label} is off — click to turn on`
      }
      aria-pressed={on}
      style={{
        width: 13,
        height: 13,
        padding: 0,
        borderRadius: '50%',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: on ? 'var(--mark)' : 'transparent',
        border: `1px solid ${on ? 'var(--mark)' : 'var(--ghost)'}`,
        boxSizing: 'border-box',
        transition: 'background .15s ease, border-color .15s ease, opacity .15s ease',
        flex: 'none',
      }}
    />
  );
}

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
  status,
  onSelect,
}: {
  logoSource: LogoSource;
  name: string;
  selected: boolean;
  panelId: string;
  status: { kind: 'toggle'; on: boolean } | { kind: 'soon' };
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
      {status.kind === 'soon' ? <span style={badgeChip}>Soon</span> : <StatusDot on={status.on} />}
    </button>
  );
}

function FeatureToggleRow({
  field,
  name,
  desc,
  on,
  masterEnabled,
  onToggle,
}: {
  field: string;
  name: string;
  desc: string;
  on: boolean;
  masterEnabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div key={field} style={featureRow}>
      <div style={{ flex: 1, opacity: masterEnabled ? 1 : 0.5 }}>
        <div style={rowLabel}>{name}</div>
        <div style={rowDesc}>{desc}</div>
      </div>
      <PluginToggle on={on} disabled={!masterEnabled} onToggle={onToggle} label={name} />
    </div>
  );
}

/**
 * Settings → Plugins (plan 026 redesign) — a 4-up logo grid (HN/GitHub/
 * YouTube/X) that expands inline below into a control panel for whichever
 * source is selected. Replaces the flat toggle-row list (plan 016) now that
 * each source has a **master `enabled`** plus the per-feature `inline`/
 * `hover` flags it supports (`SettingsMap['plugins']`, plan 026 schema —
 * see `packages/core/src/settings/schema.ts`'s doc comment).
 *
 * The master toggle flips `.enabled`; feature toggles flip `.inline`/`.hover`
 * and are greyed + disabled while `.enabled` is off (the plan's rule — a
 * disabled source's feature choices are PRESERVED, not reset, so re-enabling
 * restores them; see `setPluginField`'s doc comment). Every write goes
 * through `setPluginField`, which reconstructs the FULL three-source object
 * (`core.setSetting('plugins', ...)` replaces the whole stored value, no
 * sub-key merge).
 *
 * Twitter/X stays a static "Soon" card — no `twitter` key exists in `core`'s
 * plugins allowlist (its rich preview comes from the page's own markup, not
 * an external-API enricher the worker can skip).
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
            status={{ kind: 'toggle', on: plugins[source.key].enabled }}
            onSelect={() => setSelected(source.key)}
          />
        ))}
        <SourceCard
          logoSource="x"
          name="Twitter / X"
          selected={selected === 'x'}
          panelId={panelId}
          status={{ kind: 'soon' }}
          onSelect={() => setSelected('x')}
        />
      </div>

      <div id={panelId} style={panelShell}>
        {selected === 'x' ? (
          <>
            <div style={panelHeaderRow}>
              <PluginLogo source="x" size={32} />
              <div style={{ flex: 1 }}>
                <div style={rowLabel}>Twitter / X</div>
                <div style={rowDesc}>Author and post text — inline and on hover</div>
              </div>
              <span style={badgeChip}>Soon</span>
            </div>
            <hr style={panelDivider} />
            <p style={rowDesc}>
              X posts already render their author and text from the page itself — a toggle-able
              plugin isn't needed here. Coming soon: hover-preview parity with the other sources.
            </p>
          </>
        ) : (
          (() => {
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
                  <PluginToggle
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
          })()
        )}
      </div>

      <p style={tabNote}>
        Plugins add inline detail and hover previews — they never change what gets saved. Turning
        one off stops new hover/inline detail from that source; existing saved links are unaffected.
      </p>
    </>
  );
}
