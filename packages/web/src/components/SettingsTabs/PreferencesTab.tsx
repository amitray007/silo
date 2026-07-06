import { useSettings, useUpdateSettings } from '../../api/hooks';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided } from './rowStyles';

/** The 7/30/90 cycle order (v3's `cyclePurge`: `{ 7: 30, 30: 90, 90: 7 }`) — clicking the button advances to the next value, wrapping back to 7 after 90. */
const NEXT_PURGE_DAYS: Record<7 | 30 | 90, 7 | 30 | 90> = { 7: 30, 30: 90, 90: 7 };

/**
 * Settings → Preferences (v3's `tabPrefs`): the Theme row (wired to the real
 * theme system via `ThemeToggle`, which now ALSO persists to `/api/settings`
 * — see `ThemeToggle`'s doc comment, plan 016) and the Trash auto-purge cycle
 * row.
 *
 * The purge cycle is NOW FUNCTIONAL (plan 016 — previously deferred, see
 * `api/routes/counts.ts`'s pre-slice deferral note): clicking the button
 * cycles 7 -> 30 -> 90 -> 7 (matching v3's `cyclePurge` exactly) and PATCHes
 * `/api/settings`. It reads from `useSettings()` (the persisted store), NOT
 * `useCounts().purgeWindowDays` (the still-env-driven constant the actual
 * purge JOB reads today) — the two can legitimately disagree until a later
 * fast-follow points the purge job at this setting instead of its env var
 * (see the plan's "Purge cycle" hand-off note); this control is honest about
 * what IT persists, not a promise about when the job will pick it up.
 */
export function PreferencesTab() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const purgeDays = settings?.trashPurgeDays ?? 30;

  function cyclePurge(): void {
    updateSettings.mutate({ trashPurgeDays: NEXT_PURGE_DAYS[purgeDays] });
  }

  return (
    <>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Theme</div>
          <div style={rowDesc}>Oat, in two lights</div>
        </div>
        <ThemeToggle />
      </div>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Trash</div>
          <div style={rowDesc}>Auto-empty deleted links after</div>
        </div>
        <button type="button" onClick={cyclePurge} className="silo-settings-btn">
          {purgeDays} days ▾
        </button>
      </div>
    </>
  );
}
