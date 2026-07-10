/**
 * Shared row/control chrome for the four Settings tabs (redesign pass,
 * matching `docs/design/refs/settings-reference.png`'s row rhythm: label +
 * description on the left, a right-aligned action, a hairline divider
 * between rows, generous vertical breathing room). Extracted so the four tab
 * files — split apart only to keep `SettingsModal`'s cognitive complexity
 * under Biome's gate — don't each carry their own copy of these literals
 * (review fix, ce-maintainability).
 *
 * Interactive buttons live in `base.css` as real classes (`.silo-settings-btn`
 * etc.) so hover/active/focus-visible/disabled can be expressed as real CSS —
 * these `CSSProperties` objects cover only the static, non-interactive row
 * layout.
 */
import type { CSSProperties } from 'react';

/** A settings row: label/description on the left, a control on the right. `borderBottom` is added per-row (the last row in a tab usually omits it). Padding roomed up from the segmented-tab era's `11px 0` to match the reference's more generous row height. */
export const settingsRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '16px 0',
};

/** The roomier row + the `--line` divider under it (every row except a tab's last). */
export const settingsRowDivided: CSSProperties = {
  ...settingsRow,
  borderBottom: '1px solid var(--line)',
};

/** A row's label line (the setting's name) — Title Case, matching the reference's row-name treatment. */
export const rowLabel: CSSProperties = {
  fontSize: 'var(--text-md)',
  fontWeight: 500,
  color: 'var(--ink)',
  lineHeight: 1.35,
};

/** A row's muted description line under the label. */
export const rowDesc: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--fnt)',
  marginTop: 3,
  lineHeight: 'var(--lh-snug)',
  textWrap: 'pretty',
};
