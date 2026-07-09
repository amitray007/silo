/**
 * Parses the command palette's raw input into a discriminated query the
 * palette can branch on (plan 024, Unit 2). Pure, synchronous, no network —
 * every case below is exercised in the sibling test file.
 *
 * Grammar (deliberately simple — a `#word` at a WORD BOUNDARY is a tag
 * marker, everything else is plain text):
 * - `"react"` -> `{ text: 'react' }` — text-only.
 * - `"react #frontend "` (a `#word` NOT at the end, i.e. followed by more
 *   input) -> `{ text: 'react', tag: 'frontend' }` — a SETTLED tag: the user
 *   has moved on from typing it (there's a trailing space or more text
 *   after), so it's treated as a complete, deliberate filter.
 * - `"react #front"` (a `#word` at the very END of the input, no trailing
 *   whitespace) -> `{ text: 'react', partialTag: 'front' }` — STILL BEING
 *   TYPED. Heuristic (a real design call, since a plain string has no cursor
 *   position to consult): a trailing `#word` with nothing after it is
 *   presumed in-progress and drives autocomplete, not a settled filter.
 *   `"#frontend"` alone (nothing else in the input) is the SAME shape at the
 *   parse level — it's still a trailing `#word` with no trailing space — so
 *   it ALSO comes back as `partialTag`, never `tag`. This is intentional:
 *   the parser can't tell "the user finished typing #frontend and wants that
 *   tag's links" from "the user is mid-word after typing #frontendsomething"
 *   — both look identical as a string. The PALETTE's data layer is what
 *   resolves the ambiguity in practice: it fires an exact tag-scoped list
 *   query off `partialTag` AND shows autocomplete suggestions for it at the
 *   same time, so a tag-only query still shows that tag's links immediately
 *   (nothing is lost), while a genuinely-partial word also gets suggestions
 *   to complete it. A trailing space (`"#frontend "`) is what promotes a
 *   `partialTag` to a settled `tag`.
 * - Multiple `#` tokens (e.g. `"react #foo #bar"`): only the LAST `#word`
 *   token is ever treated as the active tag/partialTag (simplest defensible
 *   behavior). Every EARLIER `#word` token folds into `text` verbatim,
 *   UNPARSED — e.g. `"react #foo #bar"` -> `{ text: 'react #foo', tag: 'bar'
 *   }` (assuming the trailing space after `#bar` — otherwise `partialTag`).
 *   Earlier `#` tokens are not treated as additional filters or stripped;
 *   they're just literal text as far as this parser is concerned.
 * - `#` embedded mid-word (e.g. `"c#programming"`) is NEVER a tag marker —
 *   only a `#` that starts a token (preceded by start-of-string or
 *   whitespace) counts. `"c#programming"` -> `{ text: 'c#programming' }`.
 * - Empty/whitespace-only input -> `{ text: '' }` (no tag, no partialTag —
 *   the palette shows its idle state, no request fires).
 * - A trailing bare `"#"` (no word after it) -> `partialTag: ''` (still
 *   "in progress typing a tag", just with nothing typed yet) — the palette
 *   can treat an empty `partialTag` as "show all tags" or nothing, its call.
 */
export type ParsedSearchQuery = {
  /** The free-text portion (every non-tag-marker token, trimmed, tokens re-joined with single spaces). Empty string when there's no text. */
  text: string;
  /** A SETTLED tag scope — present only when the trailing `#word` token is followed by whitespace (or more input), i.e. the user has moved past it. */
  tag?: string;
  /** An IN-PROGRESS tag token — present only when the input's very last token is `#word` with no trailing whitespace. Mutually exclusive with `tag`. */
  partialTag?: string;
};

/** Matches a `#`-prefixed token at a word boundary: start-of-string or preceded by whitespace. Captures the word characters after `#` (empty capture allowed, for a bare trailing `#`). */
const TAG_TOKEN_RE = /(^|\s)#([^\s#]*)/g;

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const trimmedEnd = raw.replace(/\s+$/, '');
  const hasTrailingWhitespace = raw.length > trimmedEnd.length;

  if (!trimmedEnd.trim()) {
    return { text: '' };
  }

  const tagTokens: Array<{ match: string; word: string; index: number }> = [];
  for (const m of trimmedEnd.matchAll(TAG_TOKEN_RE)) {
    tagTokens.push({ match: m[0], word: m[2] ?? '', index: m.index });
  }

  if (tagTokens.length === 0) {
    return { text: trimmedEnd.trim() };
  }

  const lastToken = tagTokens[tagTokens.length - 1];
  if (!lastToken) {
    return { text: trimmedEnd.trim() };
  }

  // Splice out just the LAST tag token's span (its leading whitespace/
  // start-of-string + `#word`) and rejoin what's before and after it as
  // `text` — earlier `#`-tokens (if any) are left in place as literal text,
  // unparsed (see doc comment), and any text AFTER the excised token (e.g.
  // "hooks" in "react #frontend hooks") is preserved too, not dropped.
  const before = trimmedEnd.slice(0, lastToken.index);
  const after = trimmedEnd.slice(lastToken.index + lastToken.match.length);
  const text = `${before} ${after}`.trim().replace(/\s+/g, ' ');

  const isLastTokenAtEnd = lastToken.index + lastToken.match.length === trimmedEnd.length;
  const isSettled = !isLastTokenAtEnd || hasTrailingWhitespace;

  if (isSettled) {
    // A settled tag with an empty word (e.g. "react# ") is degenerate —
    // treat it as no tag at all rather than filtering on an empty string.
    if (!lastToken.word) {
      return text ? { text } : { text: '' };
    }
    return text ? { text, tag: lastToken.word } : { text: '', tag: lastToken.word };
  }

  return text ? { text, partialTag: lastToken.word } : { text: '', partialTag: lastToken.word };
}
