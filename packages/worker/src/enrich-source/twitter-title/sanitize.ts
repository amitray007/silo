/** Titles longer than this are cut at a word boundary. */
const TITLE_MAX_CHARS = 70;
const TITLE_MIN_CHARS = 3;

const EMOJI = /\p{Extended_Pictographic}|\u200d|\ufe0e|\ufe0f/gu;
const LABEL = /^title\s*:\s*/i;
const REFUSAL = /^(i can't|i can’t|i cannot|sorry)/i;
const QUOTES = /^["'`“”‘’«»]+|["'`“”‘’«»]+$/g;

/** Drops surrounding quotes and backticks, then trims. */
function unquote(text: string): string {
  return text.trim().replace(QUOTES, '').trim();
}

/** Cuts at the last space at or before `max`; a single long word is cut hard. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const space = head.lastIndexOf(' ');
  return (space > 0 ? head.slice(0, space) : Array.from(text).slice(0, max).join('')).trimEnd();
}

/**
 * Cleans the model's title. Deterministic. Returns `null` to reject (the caller
 * then keeps the page title). Steps: first line, drop a `Title:` label, quotes
 * and backticks, emojis, `#` and `@` prefixes, a trailing `.`, `!` or `…`;
 * collapse whitespace. Reject when under 3 characters, when it holds a URL, or
 * when it reads like a refusal. Over 70 characters: cut at a word boundary.
 */
export function postProcess(raw: string): string | null {
  let title = raw.trim().split(/\r?\n/, 1)[0] ?? '';
  title = unquote(title).replace(LABEL, '');
  title = unquote(title).replace(EMOJI, '');
  title = title.replace(/(^|\s)[#@]+(?=\S)/g, '$1');
  title = title.replace(/\s+/g, ' ').trim();
  title = unquote(title.replace(/(?:[.!]|…)+$/u, '').trim())
    .replace(/(?:[.!]|…)+$/u, '')
    .trim();
  // A refusal is judged on the cleaned text; quotes around it must not hide it.
  if (title.length < TITLE_MIN_CHARS) return null;
  if (/http/i.test(title) || /www\./i.test(title)) return null;
  if (REFUSAL.test(title)) return null;
  return cutAtWord(title, TITLE_MAX_CHARS);
}
