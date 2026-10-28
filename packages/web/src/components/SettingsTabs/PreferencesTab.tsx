import { useSettings, useUpdateSettings } from '../../api/hooks';
import type { SettingsMap } from '../../api/types';
import { useCompactLinks } from '../../lib/useCompactLinks';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided } from './rowStyles';
import { SettingsSelect } from './SettingsSelect';
import { ToggleSwitch } from './ToggleSwitch';

const PURGE_DAY_OPTIONS = [7, 30, 90] as const satisfies readonly SettingsMap['trashPurgeDays'][];

const PURGE_GROUPS = [
  { options: PURGE_DAY_OPTIONS.map((days) => ({ value: days, label: `${days} days` })) },
];

function TrashPurgeDropdown({
  value,
  onChange,
}: {
  value: SettingsMap['trashPurgeDays'];
  onChange: (value: SettingsMap['trashPurgeDays']) => void;
}) {
  return (
    <SettingsSelect
      ariaLabel="Trash auto-empty window"
      value={value}
      groups={PURGE_GROUPS}
      onChange={onChange}
    />
  );
}

/**
 * Settings → Preferences (v3's `tabPrefs`): the Theme row (wired to the real
 * theme system via `ThemeToggle`, which now ALSO persists to `/api/settings`
 * — see `ThemeToggle`'s doc comment, plan 016) and the Trash auto-purge
 * dropdown row.
 *
 * The purge window is functional (plan 016 — previously deferred, see
 * `api/routes/counts.ts`'s pre-slice deferral note): selecting 7/30/90 days
 * PATCHes `/api/settings`. It reads from `useSettings()` (the persisted store), NOT
 * `useCounts().purgeWindowDays` (the still-env-driven constant the actual
 * purge JOB reads today) — the two can legitimately disagree until a later
 * fast-follow points the purge job at this setting instead of its env var
 * (see the plan's "Purge cycle" hand-off note); this control is honest about
 * what IT persists, not a promise about when the job will pick it up.
 */
export function PreferencesTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const [compact, setCompact] = useCompactLinks();
  const purgeDays = settings?.trashPurgeDays ?? 30;

  function setPurgeDays(value: SettingsMap['trashPurgeDays']): void {
    updateSettings.mutate({ trashPurgeDays: value });
  }

  return (
    <>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Compact links</div>
          <div style={rowDesc}>Show links in one line on this browser.</div>
        </div>
        <ToggleSwitch label="Compact links" on={compact} onToggle={() => setCompact(!compact)} />
      </div>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Theme</div>
          <div style={rowDesc}>Match the app to light or dark.</div>
        </div>
        <ThemeToggle />
      </div>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Trash</div>
          <div style={rowDesc}>Auto-empty deleted links after</div>
        </div>
        <TrashPurgeDropdown value={purgeDays} onChange={setPurgeDays} />
      </div>
    </>
  );
}
