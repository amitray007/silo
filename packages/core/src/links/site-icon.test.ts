import { afterEach, describe, expect, it } from 'vitest';
import { findSiteIcons, setSiteIconFinder } from './site-icon.js';

describe('site icon port', () => {
  afterEach(() => setSiteIconFinder(undefined));

  it('returns no icons when no finder is registered', async () => {
    expect(await findSiteIcons('example.com', new AbortController().signal)).toEqual([]);
  });

  it('delegates to the registered finder', async () => {
    setSiteIconFinder(async (domain) => [`https://${domain}/icon.png`]);
    expect(await findSiteIcons('example.com', new AbortController().signal)).toEqual([
      'https://example.com/icon.png',
    ]);
  });
});
