import { useEffect, useId, useRef, useState } from 'react';
import { useSettings, useUpdateSettings } from '../../api/hooks';
import type { SettingsMap } from '../../api/types';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { rowDesc, rowLabel, settingsRow, settingsRowDivided } from './rowStyles';

const PURGE_DAY_OPTIONS = [7, 30, 90] as const satisfies readonly SettingsMap['trashPurgeDays'][];

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4.5 6.5 3.5 3 3.5-3" />
    </svg>
  );
}

function TrashPurgeDropdown({
  value,
  onChange,
}: {
  value: SettingsMap['trashPurgeDays'];
  onChange: (value: SettingsMap['trashPurgeDays']) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function selectValue(nextValue: SettingsMap['trashPurgeDays']) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <span ref={rootRef} className="silo-settings-select-wrap">
      <button
        type="button"
        className="silo-settings-select-trigger"
        aria-label="Trash auto-empty window"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <span>{value} days</span>
        <span aria-hidden="true" className="silo-settings-select-chevron">
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <div id={listboxId} role="listbox" className="silo-settings-select-menu">
          {PURGE_DAY_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              role="option"
              aria-selected={days === value}
              className="silo-settings-select-option"
              onClick={() => selectValue(days)}
            >
              <span>{days} days</span>
              {days === value && (
                <span aria-hidden="true" className="silo-settings-select-check">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
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
  const purgeDays = settings?.trashPurgeDays ?? 30;

  function setPurgeDays(value: SettingsMap['trashPurgeDays']): void {
    updateSettings.mutate({ trashPurgeDays: value });
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
        <TrashPurgeDropdown value={purgeDays} onChange={setPurgeDays} />
      </div>
    </>
  );
}
