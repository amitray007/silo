/**
 * Splits an X post's text into plain text and links. The Reader renders each
 * token as a React element, so nothing here builds HTML. Only http(s) URLs,
 * @handles and #hashtags become links; anything else stays text.
 */
export type PostToken =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string; kind: 'url' | 'mention' | 'hashtag' };

/**
 * A URL runs to the next space, angle bracket, quote, CJK/full-width punctuation
 * or invisible format character (a right-to-left override could fake the shown address).
 */
const URL_RUN = /https?:\/\/[^\s<>"　-〿＀-￯\p{Cf}]+/giu;
/** The leading group keeps a handle or tag from starting inside a word, so `a@b.com` is not a mention. */
const MARK = /(^|[^\p{L}\p{M}\p{N}_@#&/])([@#])([\p{L}\p{M}\p{N}_]+)/gu;

const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '*', '…']);
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** Drops sentence punctuation and unmatched closing brackets that trail a URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (last === undefined) return url;
    const opener = CLOSERS[last];
    const unmatched = opener !== undefined && count(url, last) > count(url, opener);
    if (!TRAILING_PUNCTUATION.has(last) && !unmatched) return url;
    url = url.slice(0, -1);
  }
}

/** The safe href for `url`, or `undefined` when it is not a plain http(s) address. */
function safeHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    // `https://x.com@evil.com` would show one host and open another.
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

function pushText(tokens: PostToken[], value: string): void {
  if (!value) return;
  const last = tokens.at(-1);
  if (last?.type === 'text') last.value += value;
  else tokens.push({ type: 'text', value });
}

function markHref(mark: string, name: string): string | undefined {
  if (mark === '@') return /^\w{1,15}$/.test(name) ? `https://x.com/${name}` : undefined;
  // X does not link all-digit tags.
  return name.length <= 100 && !/^\p{N}+$/u.test(name)
    ? `https://x.com/hashtag/${encodeURIComponent(name)}`
    : undefined;
}

/** Handles and hashtags in a stretch of text that holds no URL. */
function pushMarks(tokens: PostToken[], text: string): void {
  let from = 0;
  for (const match of text.matchAll(MARK)) {
    const [whole, lead = '', mark = '', name = ''] = match;
    const href = markHref(mark, name);
    if (!href) continue;
    const start = match.index + lead.length;
    pushText(tokens, text.slice(from, start));
    tokens.push({
      type: 'link',
      value: `${mark}${name}`,
      href,
      kind: mark === '@' ? 'mention' : 'hashtag',
    });
    from = match.index + whole.length;
  }
  pushText(tokens, text.slice(from));
}

export function tokenizePostText(text: string): PostToken[] {
  const tokens: PostToken[] = [];
  let from = 0;
  for (const match of text.matchAll(URL_RUN)) {
    const url = trimUrl(match[0]);
    const href = safeHref(url);
    if (!href) continue;
    pushMarks(tokens, text.slice(from, match.index));
    tokens.push({ type: 'link', value: url, href, kind: 'url' });
    from = match.index + url.length;
  }
  pushMarks(tokens, text.slice(from));
  return tokens;
}
