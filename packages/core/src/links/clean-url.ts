import type { Executor } from './executor.js';

export interface LinkCleaning {
  enabled: boolean;
  everySite: string[];
  sites: { domain: string; strip: string[]; keep: string[] }[];
}

export const LINK_CLEANING_DEFAULTS: LinkCleaning = {
  enabled: true,
  everySite:
    'utm_* fbclid gclid gbraid wbraid dclid msclkid yclid ttclid twclid li_fat_id igshid igsh mc_cid mc_eid _hsenc _hsmi __hstc __hssc __hsfp hsCtaTracking mkt_tok _gl vero_id oly_anon_id oly_enc_id rb_clickid s_cid wickedid srsltid'.split(
      ' ',
    ),
  sites: [
    ['youtube.com', 'si feature pp'],
    ['youtu.be', 'si feature pp'],
    ['open.spotify.com', 'si context'],
    ['x.com', 's t ref_src ref_url'],
    ['twitter.com', 's t ref_src ref_url'],
    ['instagram.com', 'igsh img_index'],
    ['linkedin.com', 'trk trackingId lipi rcm'],
    ['reddit.com', 'share_id rdt'],
    ['nytimes.com', 'smid smtyp'],
    ['medium.com', 'source'],
  ].map(([domain, strip]) => ({ domain: domain ?? '', strip: (strip ?? '').split(' '), keep: [] })),
};

function matches(name: string, patterns: string[]): boolean {
  return patterns.some((entry) => {
    const pattern = entry.toLowerCase();
    return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
  });
}

export function cleanUrl(rawUrl: string, config: LinkCleaning): { url: string; removed: string[] } {
  const unchanged = { url: rawUrl, removed: [] as string[] };
  try {
    if (!config.enabled) return unchanged;
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return unchanged;
    const hashAt = rawUrl.indexOf('#');
    const end = hashAt < 0 ? rawUrl.length : hashAt;
    const queryAt = rawUrl.indexOf('?');
    if (queryAt < 0 || queryAt > end) return unchanged;
    const rules = config.sites.filter(
      ({ domain }) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    );
    const removed: string[] = [];
    const kept = rawUrl
      .slice(queryAt + 1, end)
      .split('&')
      .filter((part) => {
        const name = new URLSearchParams(part).keys().next().value;
        if (name === undefined) return true;
        const lower = name.toLowerCase();
        if (rules.some((rule) => matches(lower, rule.keep))) return true;
        if (rules.some((rule) => matches(lower, rule.strip)) || matches(lower, config.everySite)) {
          removed.push(name);
          return false;
        }
        return true;
      });
    if (!removed.length) return unchanged;
    return {
      url:
        rawUrl.slice(0, queryAt) +
        (kept.some((part) => part !== '') ? `?${kept.join('&')}` : '') +
        rawUrl.slice(end),
      removed,
    };
  } catch {
    return unchanged;
  }
}

export async function loadUrlCleaner(database?: Executor): Promise<(rawUrl: string) => string> {
  const { getSetting } = await import('../settings/settings.js');
  const config = await getSetting('linkCleaning', database);
  return (rawUrl) => cleanUrl(rawUrl, config).url;
}
