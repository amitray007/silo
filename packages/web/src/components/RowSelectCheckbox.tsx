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
    <button
      type="button"
      title="select"
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
