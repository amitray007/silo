/** The context kept on each side of a quote. */
export const HIGHLIGHT_CONTEXT_MAX = 64;

/** Collapse whitespace runs to one space, like the reader's text walk. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Up to 64 characters before `at`, never starting inside a surrogate pair. */
export function contextBefore(text: string, at: number): string {
  let from = Math.max(0, at - HIGHLIGHT_CONTEXT_MAX);
  if (from > 0 && isLow(text.charCodeAt(from)) && isHigh(text.charCodeAt(from - 1))) from += 1;
  return text.slice(from, at);
}

/** Up to 64 characters from `at`, never ending inside a surrogate pair. */
export function contextAfter(text: string, at: number): string {
  let to = Math.min(text.length, at + HIGHLIGHT_CONTEXT_MAX);
  if (to < text.length && isLow(text.charCodeAt(to)) && isHigh(text.charCodeAt(to - 1))) to -= 1;
  return text.slice(at, to);
}
