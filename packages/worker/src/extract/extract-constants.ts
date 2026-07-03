/**
 * Constants shared between extract.ts and embedded-json.ts. Split out so the
 * two modules reference the SAME threshold rather than each hardcoding the
 * literal `200` independently — a single source of truth prevents the two
 * from silently drifting apart if one is ever tuned without the other.
 */

/**
 * `full` requires readable text at or above this length (characters). Below
 * it, text is considered too thin to call a genuine article capture — chosen
 * as a small-but-nontrivial floor: enough to rule out a single sentence /
 * nav fragment, small enough not to punish genuinely short posts (e.g. a
 * terse blog note or a tweet-length capture) once paired with metadata.
 *
 * embedded-json.ts also uses this as its bar for accepting a body-shaped
 * recovered field as real prose (see `BODY_KEYS` there) — a recovered string
 * shorter than what would count as "full" text isn't worth accepting either.
 */
export const FULL_TEXT_THRESHOLD = 200;
