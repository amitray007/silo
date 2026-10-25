export function chipLetter(domain: string | null | undefined): string {
  const segment = (
    String(domain ?? '')
      .replace(/^www\./i, '')
      .split('.')[0] ?? ''
  ).replace(/[^a-z0-9]/gi, '');
  return segment ? segment.charAt(0).toUpperCase() : '·';
}

const glyphs: Record<string, string> = {
  'x.com': '𝕏',
  'inkandswitch.com': 'I&',
  'github.com': 'GH',
  'simonwillison.net': 'SW',
  'maggieappleton.com': 'MA',
  'youtube.com': '▶',
  'news.ycombinator.com': 'Y',
  'paulgraham.com': 'PG',
};

/** Local letter chips use the prototype's fixed source colors, with no requests. */
export function Chip({ domain, size = 20 }: { domain: string | null | undefined; size?: number }) {
  const host = String(domain ?? '')
    .replace(/^www\./i, '')
    .toLowerCase();
  const tone = [...host].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 8;
  return (
    <span
      className="silo-letter-chip"
      data-tone={tone}
      data-domain={host}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {glyphs[host] ?? chipLetter(host)}
    </span>
  );
}
