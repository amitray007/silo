/**
 * The day-group heading (v3 — the small ghost-colored label above each bucket
 * of rows) — shared by `DayGroup` (Library/Tag) and `TrashDayGroup` (Trash),
 * which are otherwise identical shells around a different row component.
 *
 * Left inset (K2, oat-conformance audit): previously `11px`, sitting at the
 * row's OUTER edge rather than under the row TITLES (`--row-inset`, 42px —
 * row pad + chip + chip→title gap). Aligning the label to `--row-inset`
 * reads as a cleaner ledger — the day label now sits directly above the
 * titles it groups, not the chips.
 */
export function DayGroupHeading({ label }: { label: string }) {
  return (
    <p
      style={{
        fontSize: '0.78rem',
        fontWeight: 500,
        color: 'var(--fnt)',
        padding: 'var(--s5) var(--s2-5) var(--s1-5) var(--row-inset)',
        margin: 0,
      }}
    >
      {label}
    </p>
  );
}
