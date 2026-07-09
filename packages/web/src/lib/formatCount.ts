/**
 * Compact count formatting for the sidebar meta column (user feedback: write
 * counts as `100`, `1.5k`, `10k` rather than long raw numbers). Below 1000 the
 * number is shown as-is; from 1000 up it's abbreviated to `k` (thousands) then
 * `m` (millions), keeping ONE decimal only when it adds information (1500 →
 * `1.5k`, 10_000 → `10k`, not `10.0k`). Lowercase suffix + no separators, to
 * stay visually quiet in the narrow meta column.
 *
 * Pure + total: any finite non-negative integer maps to a short string; a
 * negative or non-finite input (shouldn't happen for a count) falls back to
 * the raw `String(n)` rather than throwing.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n < 1000) return String(n);

  const [value, suffix] = n < 1_000_000 ? [n / 1000, 'k'] : [n / 1_000_000, 'm'];
  // One decimal, but drop a trailing `.0` (10.0k → 10k). `toFixed(1)` then a
  // regex strip is simpler + more predictable here than juggling Intl options.
  const rounded = value.toFixed(1).replace(/\.0$/, '');
  return `${rounded}${suffix}`;
}
