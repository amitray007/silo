import { useUpdateSettings } from '../api/hooks';
import { useTheme } from './ThemeProvider';
import type { Theme } from './theme';

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The prototype's top-left segmented light/dark toggle. Active option is ink
 * text on a raised (--hov) background — amber never fills a control, per the
 * Oat anti-slop rule.
 *
 * Plan 016: picking an option applies + persists locally (unchanged —
 * `setTheme` still writes `data-theme` + localStorage immediately, so the
 * toggle stays instant even if the network write below is slow/offline) AND
 * fires a best-effort `PATCH /api/settings { theme }` so the choice survives
 * a reload on this or another device. The PATCH result is intentionally
 * fire-and-forget (`.catch(() => {})`) — a failed persist leaves the LOCAL
 * theme change in effect (localStorage/`data-theme` already applied,
 * unaffected by the request outcome); the alternative (rolling the visible
 * theme back on a network hiccup) would be jarring for a control that must
 * feel instant, and `ThemeSettingsSync` will simply re-sync from whatever
 * the server has on the next full load.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const updateSettings = useUpdateSettings();

  function selectTheme(value: Theme): void {
    setTheme(value);
    updateSettings.mutate({ theme: value });
  }

  return (
    <fieldset
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 2,
        margin: 0,
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--bg2)',
      }}
    >
      <legend
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        Theme
      </legend>
      {OPTIONS.map((option) => {
        const active = option.value === theme;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className="silo-theme-toggle-btn"
            onClick={() => selectTheme(option.value)}
            style={{
              appearance: 'none',
              border: 0,
              borderRadius: 6,
              padding: '5px 10px',
              fontFamily: 'inherit',
              fontSize: 'var(--text-sm)',
              fontWeight: active ? 500 : 400,
              cursor: 'pointer',
              color: active ? 'var(--ink)' : 'var(--ghost)',
              background: active ? 'var(--hov)' : 'transparent',
              transform: 'scale(1)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
