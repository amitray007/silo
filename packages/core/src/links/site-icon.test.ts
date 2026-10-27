import { afterEach, describe, expect, it } from 'vitest';
import { findSiteIcon, setSiteIconFinder } from './site-icon.js';

describe('site icon port', () => {
  afterEach(() => setSiteIconFinder(undefined));

  it('returns undefined when no finder is registered', async () => {
    expect(await findSiteIcon('example.com', new AbortController().signal)).toBeUndefined();
  });

  it('delegates to the registered finder', async () => {
    setSiteIconFinder(async (domain) => `https://${domain}/icon.png`);
    expect(await findSiteIcon('example.com', new AbortController().signal)).toBe(
      'https://example.com/icon.png',
    );
  });
});
