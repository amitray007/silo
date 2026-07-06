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
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

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
            onClick={() => setTheme(option.value)}
            style={{
              appearance: 'none',
              border: 0,
              borderRadius: 6,
              padding: '5px 10px',
              fontFamily: 'inherit',
              fontSize: '0.78rem',
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
