import { getSetting } from '../settings/settings.js';
import type { Executor } from './executor.js';

import type { LinkCleaning } from './link-cleaning-defaults.js';

export type { LinkCleaning } from './link-cleaning-defaults.js';
export { LINK_CLEANING_DEFAULTS } from './link-cleaning-defaults.js';

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

export type UrlCleaner = (rawUrl: string) => string;

export async function loadUrlCleaner(database?: Executor): Promise<UrlCleaner> {
  const config = await getSetting('linkCleaning', database);
  return (rawUrl) => cleanUrl(rawUrl, config).url;
}
