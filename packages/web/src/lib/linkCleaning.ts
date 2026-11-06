/**
 * Client-side checks for the Links settings tab. The patterns mirror core's
 * `settingsSchema.linkCleaning`, which stays the authority: web validates only so a bad entry
 * shows an inline error instead of a failed save.
 */
import type { LinkCleaningSite } from '../api/types';

const PARAM_PATTERN = /^[A-Za-z0-9_.\-~[\]]{1,100}\*?$/;
const DOMAIN_PATTERN = /^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export const EVERY_SITE_MAX = 500;
export const SITES_MAX = 500;
export const SITE_PARAMS_MAX = 100;

/** Reduce what the owner typed or pasted to a bare host: no scheme, `www.`, path, or port. */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.replace(/[/?#].*$/, '');
  host = host.replace(/^[^@]*@/, '');
  host = host.replace(/:\d*$/, '');
  host = host.replace(/\.+$/, '');
  return host.replace(/^www\./, '');
}

/** The reason a normalized domain cannot be saved, or null. */
export function domainProblem(domain: string, others: readonly string[]): string | null {
  if (!domain) return 'Enter a domain, like youtube.com.';
  if (domain.length > 253 || !DOMAIN_PATTERN.test(domain))
    return `“${domain}” is not a domain. Use a form like youtube.com.`;
  if (others.includes(domain)) return `${domain} already has a rule.`;
  return null;
}

/** Split a typed or pasted list on commas and whitespace; flag names the setting would refuse. */
export function parseParams(input: string): { names: string[]; invalid: string[] } {
  const names: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const token of input.split(/[\s,]+/)) {
    if (!token) continue;
    if (!PARAM_PATTERN.test(token)) {
      invalid.push(token);
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(token);
  }
  return { names, invalid };
}

/**
 * Add pasted names to a list. Names already present (any letter case) are skipped.
 * Returns the new list, or the reason it cannot be saved.
 */
export function addParams(
  current: readonly string[],
  input: string,
  max: number,
): { list: string[] } | { problem: string } {
  const { names, invalid } = parseParams(input);
  if (invalid.length > 0)
    return {
      problem: `${invalid.map((name) => `“${name}”`).join(', ')} can't be a parameter name. Use letters, digits, and _ . - ~ [ ], with * only at the end.`,
    };
  if (names.length === 0) return { problem: 'Enter a parameter name, like utm_source.' };
  const have = new Set(current.map((name) => name.toLowerCase()));
  const fresh = names.filter((name) => !have.has(name.toLowerCase()));
  if (fresh.length === 0) return { problem: 'Already in the list.' };
  if (current.length + fresh.length > max) return { problem: `A list holds at most ${max} names.` };
  return { list: [...current, ...fresh] };
}

export function withSite(
  sites: readonly LinkCleaningSite[],
  domain: string,
  change: (site: LinkCleaningSite) => LinkCleaningSite,
): LinkCleaningSite[] {
  return sites.map((site) => (site.domain === domain ? change(site) : site));
}
