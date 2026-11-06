/**
 * Max characters of plain-text excerpt `list()`'s `snippet` carries (agent-
 * navigation slice U2). `list` has no query to focus a `ts_headline` around
 * (unlike `search`'s query-highlighted snippet), so its snippet is a plain
 * truncation: just enough to let an agent recognize a link without paying for
 * the full article body.
 */
export const LIST_SNIPPET_MAX_CHARS = 200;

/** Raw characters the first pass collapses; later passes grow it by `SLICE_GROWTH`. */
const SLICE_START = 1024;
const SLICE_GROWTH = 4;

/** Returned when a text that is only a prefix of the stored value is too short to settle the snippet. */
export const NEEDS_FULL_TEXT = Symbol('needs-full-text');

/** The excerpt for an already whitespace-collapsed, trimmed string. */
function cutSnippet(collapsed: string): string | null {
  if (!collapsed) return null;
  if (collapsed.length <= LIST_SNIPPET_MAX_CHARS) return collapsed;

  const hardCut = collapsed.slice(0, LIST_SNIPPET_MAX_CHARS);
  const lastSpace = hardCut.lastIndexOf(' ');
  // Prefer breaking on the last whitespace boundary within the cut, but only
  // if that doesn't throw away a large chunk of the budget (a boundary very
  // early in the slice means the text has few/no spaces near the cutoff —
  // just hard-cut instead of over-truncating).
  const cut = lastSpace > LIST_SNIPPET_MAX_CHARS * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut}…`;
}

/**
 * Single-line, whitespace-collapsed, ellipsized plain-text excerpt for
 * `list()`'s `snippet`. `null` only when the text is empty or all whitespace.
 * Truncates to `LIST_SNIPPET_MAX_CHARS` characters, breaking on a whitespace
 * boundary where one exists nearby so the excerpt doesn't end mid-word, and
 * appends an ellipsis whenever the source text was cut.
 *
 * The result depends only on the first `LIST_SNIPPET_MAX_CHARS + 1` characters
 * of the whitespace-collapsed text, so the collapse regex runs over a bounded
 * raw slice instead of a whole article body (about 20 KB). A slice whose
 * collapsed form is too short to prove the answer is grown and retried, so the
 * output is identical to collapsing the entire text however whitespace-heavy it
 * is.
 *
 * `complete` says whether `text` is the whole stored value. When it is only a
 * prefix of it (the list query reads `left(extracted_text, N)`), a prefix too
 * short to settle the answer returns `NEEDS_FULL_TEXT`: the caller re-reads the
 * whole value and calls again with `complete: true`.
 */
export function snippetFromText(text: string | null | undefined, complete: true): string | null;
export function snippetFromText(
  text: string | null | undefined,
  complete: boolean,
): string | null | typeof NEEDS_FULL_TEXT;
export function snippetFromText(
  text: string | null | undefined,
  complete: boolean,
): string | null | typeof NEEDS_FULL_TEXT {
  if (!text) return null;
  for (let sliceLength = SLICE_START; ; sliceLength *= SLICE_GROWTH) {
    const slice = text.length > sliceLength ? text.slice(0, sliceLength) : text;
    const sliceIsWholeValue = complete && slice.length === text.length;
    const collapsed = slice.replace(/\s+/g, ' ').trimStart();
    if (sliceIsWholeValue) return cutSnippet(collapsed.trimEnd());
    // A partial slice settles the answer once a non-space character sits past
    // the budget: that character exists in the full text too, so the first
    // LIST_SNIPPET_MAX_CHARS + 1 collapsed characters are final. A trailing
    // space alone proves nothing (the rest of the value may be all whitespace).
    if (collapsed.trimEnd().length > LIST_SNIPPET_MAX_CHARS) return cutSnippet(collapsed);
    if (slice.length === text.length) return NEEDS_FULL_TEXT;
  }
}
