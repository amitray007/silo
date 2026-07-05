/** The day-group heading (v3 — the small ghost-colored label above each bucket of rows) — shared by `DayGroup` (Library/Tag) and `TrashDayGroup` (Trash), which are otherwise identical shells around a different row component. */
export function DayGroupHeading({ label }: { label: string }) {
  return (
    <p
      style={{
        fontSize: '0.78rem',
        fontWeight: 500,
        color: 'var(--ghost)',
        padding: '20px 11px 6px',
        margin: 0,
      }}
    >
      {label}
    </p>
  );
}
