import { useSettings, useUpdateSettings } from '../../api/hooks';
import type { SettingsMap } from '../../api/types';
import { badgeChip, rowDesc, rowLabel, settingsRowDivided, tabNote } from './rowStyles';

/**
 * Row metadata for the three TOGGLEABLE plugins (plan 016 — `hacker_news`/
 * `github`/`youtube`; mirrors `@silo/core`'s `settingsSchema.plugins`
 * allowlist EXACTLY, see `packages/core/src/settings/schema.ts`'s doc
 * comment for why `link`/`twitter` are excluded: `link` has no enricher to
 * toggle, and `twitter`'s rich data comes from the page itself, not an
 * external-API enricher). `key` indexes directly into
 * `SettingsMap['plugins']`.
 */
const TOGGLEABLE_PLUGIN_ROWS = [
  { key: 'hacker_news', name: 'Hacker News', desc: 'Points and comments — inline and on hover' },
  { key: 'github', name: 'GitHub', desc: 'Repo card on hover — stars, forks, issues' },
  { key: 'youtube', name: 'YouTube', desc: 'Thumbnail and channel preview on hover' },
] as const satisfies ReadonlyArray<{
  key: keyof SettingsMap['plugins'];
  name: string;
  desc: string;
}>;

/**
 * Settings → Plugins (v3's `tabPlugins`, `pluginRows`) — NOW FUNCTIONAL for
 * the three enricher-backed plugins (plan 016; previously parked behind "no
 * plugin system yet", see this file's pre-slice doc comment). Each row's dot
 * toggles on/off and PATCHes `/api/settings { plugins: {...} }` with the
 * FULL plugins record (the toggle only flips ONE key locally, but the write
 * always sends the complete three-key object — `core.setSetting('plugins',
 * ...)` replaces the whole stored value, it doesn't merge sub-keys).
 *
 * Twitter/X keeps its ORIGINAL v3 row (name/desc unchanged) but stays a
 * static "Soon" chip, NOT a toggle — there is no `twitter` key in
 * `core`'s plugins allowlist (its rich preview comes from the page's own
 * markup, not an external-API enricher the worker can skip) — see the plan's
 * `plugins` schema note (`{ hacker_news, github, youtube }`, no `twitter`).
 *
 * IMPORTANT scope boundary (plan 016 hand-off, documented per the build
 * brief): toggling a plugin off HERE persists the preference and is exposed
 * to any reader, but nothing in the enrichment WORKER reads it yet — no
 * enricher is actually skipped when its toggle is off. Wiring worker
 * enforcement risks touching the same `packages/worker/src/enrich*` files a
 * parallel scheduling slice owns, so it's deliberately left as a documented,
 * tiny follow-up rather than done here.
 */
export function PluginsTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const plugins = settings?.plugins;

  function togglePlugin(key: keyof SettingsMap['plugins']): void {
    if (!plugins) return;
    updateSettings.mutate({ plugins: { ...plugins, [key]: !plugins[key] } });
  }

  return (
    <>
      {TOGGLEABLE_PLUGIN_ROWS.map((plugin) => {
        const enabled = plugins?.[plugin.key] ?? true;
        return (
          <div key={plugin.key} style={settingsRowDivided}>
            <div style={{ flex: 1 }}>
              <div style={rowLabel}>{plugin.name}</div>
              <div style={rowDesc}>{plugin.desc}</div>
            </div>
            <button
              type="button"
              onClick={() => togglePlugin(plugin.key)}
              disabled={!plugins}
              title={
                !plugins
                  ? `${plugin.name} — loading…`
                  : enabled
                    ? `${plugin.name} is on — click to turn off`
                    : `${plugin.name} is off — click to turn on`
              }
              aria-pressed={enabled}
              style={{
                width: 13,
                height: 13,
                padding: 0,
                borderRadius: '50%',
                cursor: plugins ? 'pointer' : 'default',
                background: enabled ? 'var(--mark)' : 'transparent',
                border: `1px solid ${enabled ? 'var(--mark)' : 'var(--ghost)'}`,
                boxSizing: 'border-box',
                transition: 'background .15s ease, border-color .15s ease',
              }}
            />
          </div>
        );
      })}
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Twitter / X</div>
          <div style={rowDesc}>Author and post text — inline and on hover</div>
        </div>
        <span style={badgeChip}>Soon</span>
      </div>
      <p style={tabNote}>
        Plugins add inline detail and hover previews — they never change what gets saved. Turning
        one off stops new hover/inline detail from that source; existing saved links are unaffected.
      </p>
    </>
  );
}
