/** Titles longer than this are cut at a word boundary. */
const TITLE_MAX_CHARS = 70;
const TITLE_MIN_CHARS = 3;

// Keep the invisible characters escaped when formatting this expression.
const EMOJI =
  /[0-9#*]\ufe0f?\u20e3|\p{Extended_Pictographic}|[\u{1f3fb}-\u{1f3ff}]|[\u{1f1e6}-\u{1f1ff}]|\u200d|\ufe0e|\ufe0f|\u20e3/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Remove database-unsafe controls, keeping whitespace.
const CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f]/g;
// Preserve emails before matching ASCII X handles or hashtag prefixes.
const SOCIAL_TOKEN =
  /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+|@[a-z0-9_]+|(?<![\p{L}\p{N}_])#+(?=[\p{L}\p{N}])/giu;
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
  const chars = Array.from(text);
  const head = chars.slice(0, max + 1).join('');
  const space = head.lastIndexOf(' ');
  const boundary = head.slice(0, Math.max(0, space)).trimEnd();
  return boundary.length >= TITLE_MIN_CHARS ? boundary : chars.slice(0, max).join('').trimEnd();
}

/**
 * Cleans the model's title. Deterministic. Returns `null` to reject (the caller
 * then keeps the page title). Steps: first line, drop a `Title:` label, quotes
 * and backticks, emoji sequences, controls, handles, hashtag prefixes, and
 * trailing punctuation; collapse whitespace, then cut to 70 characters.
 * Reject the final title when under 3 characters, when it holds a URL, or
 * when it reads like a refusal.
 */
export function postProcess(raw: string): string | null {
  let title = raw.trim().split(/\r?\n/, 1)[0] ?? '';
  title = unquote(title).replace(LABEL, '');
  title = unquote(title).replace(EMOJI, '').replace(CONTROLS, '');
  title = title.replace(SOCIAL_TOKEN, (token) =>
    token.startsWith('@') || /^#+$/.test(token) ? '' : token,
  );
  title = title.replace(/[\s\u0085]+/g, ' ').trim();
  title = unquote(title.replace(/(?:[.!]|…)+$/u, '').trim())
    .replace(/(?:[.!]|…)+$/u, '')
    .trim();
  title = cutAtWord(title, TITLE_MAX_CHARS);
  // Every reject check uses the final text, including any truncation.
  if (title.length < TITLE_MIN_CHARS) return null;
  if (/http/i.test(title) || /www\./i.test(title)) return null;
  if (REFUSAL.test(title)) return null;
  return title;
}
