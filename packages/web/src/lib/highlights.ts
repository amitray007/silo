/** The five semantic highlight colours, in the order a new overlap picks the next free one. */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'violet'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function isHighlightColor(value: unknown): value is HighlightColor {
  return HIGHLIGHT_COLORS.some((color) => color === value);
}

/** The wanted colour, or the next palette colour that no overlapping highlight uses. */
export function chooseColor(
  wanted: HighlightColor,
  used: ReadonlySet<HighlightColor>,
): HighlightColor {
  if (!used.has(wanted)) return wanted;
  const start = HIGHLIGHT_COLORS.indexOf(wanted);
  for (let step = 1; step < HIGHLIGHT_COLORS.length; step += 1) {
    const next = HIGHLIGHT_COLORS[(start + step) % HIGHLIGHT_COLORS.length];
    if (next && !used.has(next)) return next;
  }
  // Every colour is taken: reuse the wanted one (the inner layer then gets an underline).
  return wanted;
}

/** The bounds the API enforces: quote length, note length, and the context kept on each side. */
export const HIGHLIGHT_QUOTE_MAX = 5000;
export const HIGHLIGHT_NOTE_MAX = 10000;
export const HIGHLIGHT_CONTEXT_MAX = 64;
