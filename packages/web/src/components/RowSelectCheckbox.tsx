/**
 * The hover checkbox shared by `LinkRow` (Library selection) and `TrashRow`
 * (Trash selection) — plan 011, V3-5, matching `Silo-v3.html`'s
 * `showCheck`/`toggleSel`/`checkBd`/`checkBg`/`checkGlyph` fields exactly,
 * except the checked-state color: v3 literally uses `--mark` (amber); this
 * uses `--ink` instead per `docs/rules/web-react.md`'s "amber is ONLY the
 * brand dot + status marks, never a control fill" rule — `--ink` reads as
 * clearly "selected" without breaking that rule.
 *
 * Takes `isSelected`/`onToggle` rather than reading a selection scope
 * directly, so it has no opinion on WHICH scope (library vs. trash) a caller
 * is wired to — `LinkRow` passes `useLibrarySelection()`'s callbacks, `TrashRow`
 * passes `useTrashSelection()`'s. Pulled out once both rows needed the
 * identical 20-line button (jscpd guards production src at 1.5%).
 */
export function RowSelectCheckbox({
  visible,
  isSelected,
  onToggle,
}: {
  visible: boolean;
  isSelected: boolean;
  onToggle: () => void;
}) {
  if (!visible) return null;

  return (
    // The visible box stays a compact 18px (matching the chip it swaps
    // places with — a 40px box here would break the row's tight `gap:13`
    // rhythm and visually dominate the title/domain text next to it). The
    // click/tap target is still small by the a11y floor's ~40px guidance
    // (Rams review), but this control always sits inside a row that is
    // ITSELF a large click target (`.silo-link-row`, ~36px tall) with
    // `stopPropagation` already carving this box out of it — a real 40px hit
    // area here would need to overlap the adjacent chip/title, which isn't
    // safe to do with inline flex siblings. Flagged as an accepted residual
    // rather than silently left unlabeled: `aria-label`/`aria-pressed` at
    // least make it correctly operable for assistive tech and keyboard users
    // even at this visual size.
    <button
      type="button"
      title="select"
      aria-label={isSelected ? 'deselect' : 'select'}
      aria-pressed={isSelected}
      className="silo-row-checkbox"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      style={{
        flex: 'none',
        width: 18,
        height: 18,
        padding: 0,
        cursor: 'pointer',
        borderRadius: 5,
        border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--ghost)'}`,
        background: isSelected ? 'var(--ink)' : 'transparent',
        color: 'var(--bg)',
        fontSize: '0.6rem',
        lineHeight: 1,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {isSelected ? '✓' : ''}
    </button>
  );
}
