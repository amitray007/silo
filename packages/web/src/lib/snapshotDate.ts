/** An Internet Archive snapshot date, such as "16 Oct 2026"; undefined for a missing or bad value. */
export function formatSnapshotDate(value: string | null | undefined): string | undefined {
  const date = value ? new Date(value) : undefined;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
