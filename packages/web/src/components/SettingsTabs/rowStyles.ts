/**
 * Shared row/control chrome for the four Settings tabs (v3's `tabPlugins`/
 * `tabPrefs`/`tabImport`/`tabAccess` all use the identical `11px 0` setting
 * row + `--line` divider + the same disabled-stub button look). Extracted so
 * the four tab files — split apart only to keep `SettingsModal`'s cognitive
 * complexity under Biome's gate — don't each carry their own copy of these
 * literals (review fix, ce-maintainability).
 */
import type { CSSProperties } from 'react';

/** A settings row: label/description on the left, a control on the right. `borderBottom` is added per-row (the last row in a tab usually omits it). */
export const settingsRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '11px 0',
};

/** The `11px 0` row + the `--line` divider under it (every row except a tab's last). */
export const settingsRowDivided: CSSProperties = {
  ...settingsRow,
  borderBottom: '1px solid var(--line)',
};

/** A disabled "not yet"/parked control button (v3's "Choose file…"/"Download"/"Rotate"/purge-cycle look, dimmed to `--ghost` + non-interactive). Callers add a `title` explaining why it's inert. */
export const stubButton: CSSProperties = {
  border: '1px solid var(--line)',
  background: 'var(--bg2)',
  borderRadius: 8,
  fontSize: '0.76rem',
  fontWeight: 500,
  color: 'var(--ghost)',
  padding: '6px 14px',
  cursor: 'default',
  fontFamily: 'inherit',
};

/** A row's bold label line (the setting's name). */
export const rowLabel: CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 500,
  color: 'var(--ink)',
};

/** A row's muted description line under the label. */
export const rowDesc: CSSProperties = {
  fontSize: '0.76rem',
  color: 'var(--fnt)',
  marginTop: 1,
};

/** The calm footer note some tabs end with (v3's `<p>` under the rows). */
export const tabNote: CSSProperties = {
  margin: '12px 0 0',
  fontSize: '0.74rem',
  color: 'var(--fnt)',
};
