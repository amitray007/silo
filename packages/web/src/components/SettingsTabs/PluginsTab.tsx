import { badgeChip, rowDesc, rowLabel, settingsRowDivided, tabNote } from './rowStyles';

const PLUGIN_ROWS = [
  { key: 'hn', name: 'Hacker News', desc: 'points and comments — inline and on hover' },
  { key: 'tw', name: 'Twitter / X', desc: 'author and post text — inline and on hover' },
  { key: 'gh', name: 'GitHub', desc: 'repo card on hover — stars, forks, issues' },
  { key: 'yt', name: 'YouTube', desc: 'thumbnail and channel preview on hover' },
] as const;

/**
 * Settings → Plugins (v3's `tabPlugins`, `pluginRows`) — PARKED behind the
 * plugin system (plan 011 decision 3 / this slice's brief: "render the rows
 * visually but non-functional"). v3's rows have a live toggle-dot + "Set up"
 * button per plugin; since there is no plugin system to toggle or set up
 * yet, this renders the same four rows with a static, dimmed "not yet"
 * affordance instead of a fake-working toggle — a disabled dot would still
 * imply an on/off state that doesn't exist, so a plain "soon" chip reads more
 * honestly than a disabled control pretending to be a real one.
 */
export function PluginsTab() {
  return (
    <>
      {PLUGIN_ROWS.map((plugin) => (
        <div key={plugin.key} style={settingsRowDivided}>
          <div style={{ flex: 1 }}>
            <div style={rowLabel}>{plugin.name}</div>
            <div style={rowDesc}>{plugin.desc}</div>
          </div>
          <span style={badgeChip}>soon</span>
        </div>
      ))}
      <p style={tabNote}>
        Plugins add inline detail and hover previews — they never change what gets saved. They
        arrive with the plugin system.
      </p>
    </>
  );
}
