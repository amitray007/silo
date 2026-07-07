import type { LinkJson } from './types.js';

/**
 * Minimal ANSI helpers — no color dependency in the catalog (`chalk`/
 * `picocolors`/etc aren't listed in `pnpm-workspace.yaml`'s catalog, and the
 * plan calls for "no heavy dep unless justified"), so this file hand-rolls
 * the handful of codes actually used. Every helper NO-OPS when stdout isn't
 * a TTY (`process.stdout.isTTY` — piped/redirected output, `--json` mode,
 * CI) so `silo list | grep foo` never has to strip escape codes.
 */
const isTty = (): boolean => Boolean(process.stdout.isTTY);

function wrap(code: string): (text: string) => string {
  return (text: string) => (isTty() ? `\x1b[${code}m${text}\x1b[0m` : text);
}

export const dim = wrap('2');
export const bold = wrap('1');
export const green = wrap('32');
export const yellow = wrap('33');
export const red = wrap('31');
const cyan = wrap('36');

/** A link's status badge — colored, silence-adjacent (mirrors the web UI's "silence means complete": `full` gets no loud marker, only `enriching`/`bare`/`partial` call attention to themselves). */
export function statusBadge(status: LinkJson['captureStatus']): string {
  switch (status) {
    case 'enriching':
      return yellow('enriching');
    case 'bare':
      return red('bare');
    case 'partial':
      return yellow('partial');
    case 'full':
      return dim('full');
  }
}

/** A short, stable id prefix (first 8 chars of the uuid) for compact list/search output — full id is still shown via `--json` or `silo open <id>` accepting a prefix. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Extracts the registrable-ish domain from a url for display (falls back to the raw url if it doesn't parse — never throws). */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * A short "rich hint" for a link's sourceData, mirroring the web UI's rich
 * previews: `★204` for a GitHub star count, `▲104` for an HN point count,
 * `♥45` for twitter likes. Returns `''` for a plain `link`/`youtube` variant
 * (no compact numeric hint fits).
 */
export function richHint(link: LinkJson): string {
  const data = link.sourceData;
  switch (data.kind) {
    case 'github':
      return `★${data.stars}`;
    case 'hacker_news':
      return `▲${data.points}`;
    case 'twitter':
      return `♥${data.likes}`;
    default:
      return '';
  }
}

/** One formatted line for a link — used by both `silo list` and `silo search` (search additionally shows `rank`, prepended by the caller). */
export function formatLinkLine(link: LinkJson): string {
  const title = link.title ?? link.url;
  const hint = richHint(link);
  const parts = [
    dim(shortId(link.id)),
    bold(title),
    dim(domainOf(link.url)),
    statusBadge(link.captureStatus),
  ];
  if (hint) parts.push(cyan(hint));
  if (link.notes) parts.push(dim(`¶ ${truncate(link.notes, 60)}`));
  return parts.join('  ');
}

/** Truncates `text` to `max` chars, appending an ellipsis when it was cut. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
