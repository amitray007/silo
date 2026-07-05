import { useCounts } from '../../api/hooks';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided } from './rowStyles';

/**
 * Settings → Preferences (v3's `tabPrefs`): the Theme row (WIRED to the real
 * theme system via `ThemeToggle`, which already renders the same segmented
 * light/dark pill as v3's `thLightC`/`thDarkC` pair — ink-on-`--hov` active,
 * never amber, per the Oat anti-slop rule) and the Trash auto-purge cycle
 * row.
 *
 * The purge cycle is NON-functional: there is no settings API to persist a
 * chosen window (`docs/rules` / the API only exposes the read-only
 * `PURGE_WINDOW_DAYS` core constant via `GET /api/counts`), so `cyclePurge`
 * has nothing to write to. Rather than fake a working `▾` cycle (v3's
 * `cyclePurge` rotates 7→30→90 purely in demo state), this shows the REAL
 * current window from `useCounts().purgeWindowDays` and disables the button
 * with a "fixed at Nd for now" title — honest about today's limit without
 * inventing client-side state that would silently do nothing server-side.
 */
export function PreferencesTab() {
  const { data: counts } = useCounts();
  const purgeDays = counts?.purgeWindowDays ?? 30;

  return (
    <>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Theme</div>
          <div style={rowDesc}>oat, in two lights</div>
        </div>
        <ThemeToggle />
      </div>
      <div style={settingsRow}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Trash</div>
          <div style={rowDesc}>auto-empty deleted links after</div>
        </div>
        <button
          type="button"
          disabled
          title={`fixed at ${purgeDays} days for now`}
          className="silo-settings-btn"
        >
          {purgeDays} days ▾
        </button>
      </div>
    </>
  );
}
