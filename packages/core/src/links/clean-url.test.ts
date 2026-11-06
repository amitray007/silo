import { describe, expect, it } from 'vitest';
import { parseSettingValue } from '../settings/schema.js';
import { cleanUrl, LINK_CLEANING_DEFAULTS } from './clean-url.js';

describe('cleanUrl', () => {
  it.each(LINK_CLEANING_DEFAULTS.everySite)('strips default %s', (param) => {
    const name = param.replace('*', 'source');
    expect(cleanUrl(`https://example.com/?${name}=x`, LINK_CLEANING_DEFAULTS)).toEqual({
      url: 'https://example.com/',
      removed: [name],
    });
  });
  it.each(LINK_CLEANING_DEFAULTS.sites)('strips curated params on $domain', (site) => {
    for (const param of site.strip) {
      expect(cleanUrl(`https://${site.domain}/?${param}=x`, LINK_CLEANING_DEFAULTS).url).toBe(
        `https://${site.domain}/`,
      );
    }
  });
  it('preserves original bytes and remaining order', () => {
    expect(
      cleanUrl('https://EXAMPLE.com/a%2fb?z=%20&UTM_source=x&a=1#hash', LINK_CLEANING_DEFAULTS),
    ).toEqual({ url: 'https://EXAMPLE.com/a%2fb?z=%20&a=1#hash', removed: ['UTM_source'] });
  });
  it('matches subdomains and respects keep over both lists', () => {
    const config = {
      enabled: true,
      everySite: ['utm_*'],
      sites: [{ domain: 'youtube.com', strip: ['si', 'utm_*'], keep: ['utm_source'] }],
    };
    expect(
      cleanUrl('https://m.youtube.com/watch?v=1&si=x&utm_source=a&utm_medium=b', config).url,
    ).toBe('https://m.youtube.com/watch?v=1&utm_source=a');
    expect(cleanUrl('https://example.com/?si=x', config).url).toBe('https://example.com/?si=x');
  });
  it('uses owner rules and disabled state', () => {
    const config = { enabled: true, everySite: ['ref'], sites: [] };
    expect(cleanUrl('https://example.com/?ref=x&utm_source=a', config).url).toBe(
      'https://example.com/?utm_source=a',
    );
    expect(cleanUrl('https://example.com/?ref=x', { ...config, enabled: false }).url).toBe(
      'https://example.com/?ref=x',
    );
  });
  it.each(['broken', 'mailto:a?utm_source=x', 'ftp://example.com/?utm_source=x'])(
    'keeps invalid or non-http %s',
    (url) => {
      expect(cleanUrl(url, LINK_CLEANING_DEFAULTS)).toEqual({ url, removed: [] });
    },
  );
});

describe('linkCleaning schema', () => {
  it('accepts defaults', () =>
    expect(parseSettingValue('linkCleaning', LINK_CLEANING_DEFAULTS)).toEqual(
      LINK_CLEANING_DEFAULTS,
    ));
  it.each([
    { ...LINK_CLEANING_DEFAULTS, extra: true },
    { ...LINK_CLEANING_DEFAULTS, everySite: ['bad name'] },
    { ...LINK_CLEANING_DEFAULTS, everySite: Array(501).fill('x') },
    { ...LINK_CLEANING_DEFAULTS, sites: [{ domain: 'www.example.com', strip: [], keep: [] }] },
    { ...LINK_CLEANING_DEFAULTS, sites: [{ domain: 'Example.com', strip: [], keep: [] }] },
    {
      ...LINK_CLEANING_DEFAULTS,
      sites: [
        { domain: 'example.com', strip: [], keep: [] },
        { domain: 'example.com', strip: [], keep: [] },
      ],
    },
  ])('rejects invalid rules', (config) =>
    expect(() => parseSettingValue('linkCleaning', config)).toThrow(),
  );
});
