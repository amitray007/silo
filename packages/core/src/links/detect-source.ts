/**
 * Pure, no-I/O URL -> source classification. The single place that maps a raw
 * URL string to "what kind of thing is this" (a Hacker News item, a GitHub
 * repo, a YouTube video, or just a plain link) — the enrichers (worker) and
 * `createLink` (this package) both key off this, so the classification logic
 * lives in exactly one place.
 *
 * Deliberately conservative: each matcher only recognizes an UNAMBIGUOUS,
 * canonical URL shape for its source. A URL that's merely "on that domain"
 * but not the exact recognized shape (e.g. `github.com/features`,
 * `github.com/owner` alone, `youtube.com/results?search_query=...`) falls
 * through to `{ kind: 'link' }` rather than guessing — a wrong/partial match
 * would either crash an enricher's assumptions (no `repo` to fetch) or badge
 * a link with metadata that doesn't belong to it. `kind: 'link'` is always a
 * safe, correct fallback (see `source-data.ts`'s `linkSourceData`).
 *
 * No I/O, no throws — every function here is a total, synchronous string ->
 * result mapping. This module owns classification only; the actual per-source
 * API calls (HN Firebase/GitHub REST/YouTube oEmbed) are the worker's job
 * (`packages/worker/src/enrich-source/`), which re-runs `detectSource` on the
 * link's stored url to recover the parsed id/owner/repo it needs to fetch.
 */

export type DetectedSource =
  | { kind: 'hacker_news'; itemId: number }
  | { kind: 'github'; owner: string; repo: string }
  | { kind: 'youtube'; videoId: string }
  | { kind: 'link' };

/** GitHub path segments that are platform features, not a `{owner}/{repo}` — a URL shaped like one of these must never be misread as a repo. */
const GITHUB_RESERVED_OWNERS: ReadonlySet<string> = new Set([
  'features',
  'settings',
  'notifications',
  'marketplace',
  'sponsors',
  'orgs',
  'topics',
  'trending',
  'collections',
  'about',
  'pricing',
  'security',
  'issues',
  'pulls',
  'explore',
  'apps',
  'codespaces',
  'gist',
  'gists',
  'login',
  'join',
  'new',
  'notes',
  'search',
  'watching',
  'stars',
  'dashboard',
]);

/** A `{owner}`/`{repo}` path segment: GitHub usernames/org + repo names are alphanumerics, hyphens, underscores, or dots — never a slash, never empty. */
const GITHUB_SEGMENT = /^[a-zA-Z0-9._-]+$/;

/** An 11-character YouTube video id: base64url-alphabet (letters, digits, `-`, `_`), exactly 11 chars — YouTube's actual id format. */
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Only http(s) URLs are classifiable — same scheme gate `canonicalize` applies
 * (a non-http(s) URL is `ok: false` there / a non-saveable-safe href), so
 * `detectSource` must not classify `ftp://github.com/o/r` or the like as a
 * rich source and disagree with that trust boundary. A non-http(s) scheme
 * degrades to `{ kind: 'link' }` like any other non-match.
 */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

function parseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

/** Strips a leading `www.` and lowercases — the same tolerance every matcher below needs for its host check. */
function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function detectHackerNews(url: URL, host: string): DetectedSource | undefined {
  if (host !== 'news.ycombinator.com') return undefined;
  if (url.pathname !== '/item') return undefined;
  const idParam = url.searchParams.get('id');
  if (!idParam || !/^\d+$/.test(idParam)) return undefined;
  const itemId = Number(idParam);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return undefined;
  return { kind: 'hacker_news', itemId };
}

function detectGitHub(url: URL, host: string): DetectedSource | undefined {
  if (host !== 'github.com') return undefined;
  // Exactly two path segments (owner, repo) — a sub-path like /owner/repo/issues
  // or a bare /owner is not a repo ROOT and must not match.
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return undefined;
  const [owner, repoWithSuffix] = segments;
  if (!owner || !repoWithSuffix) return undefined;
  // A repo name can legitimately end in `.git` in some contexts; strip it so
  // `github.com/owner/repo.git` still resolves to the same repo as
  // `github.com/owner/repo` (both are canonical ways to reference it).
  const repo = repoWithSuffix.replace(/\.git$/i, '');
  if (!repo) return undefined;
  if (GITHUB_RESERVED_OWNERS.has(owner.toLowerCase())) return undefined;
  if (!GITHUB_SEGMENT.test(owner) || !GITHUB_SEGMENT.test(repo)) return undefined;
  return { kind: 'github', owner, repo };
}

function detectYouTube(url: URL, host: string): DetectedSource | undefined {
  if (host === 'youtu.be') {
    const segments = url.pathname.split('/').filter(Boolean);
    const videoId = segments[0];
    if (videoId && YOUTUBE_ID_RE.test(videoId)) {
      return { kind: 'youtube', videoId };
    }
    return undefined;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname !== '/watch') return undefined;
    const videoId = url.searchParams.get('v');
    if (videoId && YOUTUBE_ID_RE.test(videoId)) {
      return { kind: 'youtube', videoId };
    }
    return undefined;
  }
  return undefined;
}

/**
 * Classify a raw URL into a `DetectedSource`. Never throws — an unparseable
 * URL (mirrors `canonicalize`'s own tolerance) degrades to `{ kind: 'link' }`,
 * same as any URL that doesn't match a recognized source shape.
 */
export function detectSource(rawUrl: string): DetectedSource {
  const url = parseUrl(rawUrl);
  if (!url) return { kind: 'link' };
  if (!ALLOWED_SCHEMES.has(url.protocol)) return { kind: 'link' };

  const host = normalizedHost(url);

  return (
    detectHackerNews(url, host) ??
    detectGitHub(url, host) ??
    detectYouTube(url, host) ?? {
      kind: 'link',
    }
  );
}
