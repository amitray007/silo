import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { blockedFetch, paywallDeclared } from './access.js';

describe('publisher access', () => {
  it.each([
    ['{"isAccessibleForFree":false}', true],
    ['{"@graph":[{"isAccessibleForFree":false}]}', true],
    ['{"hasPart":[{"isAccessibleForFree":false}]}', true],
    ['{"isAccessibleForFree":"false"}', true],
    ['{"isAccessibleForFree":true}', false],
    ['{}', false],
    ['broken', false],
  ])('reads %s', (json, expected) => {
    const dom = new JSDOM(`<script type="application/ld+json">${json}</script>`);
    expect(paywallDeclared(dom.window.document)).toBe(expected);
    dom.window.close();
  });
  it.each([
    [401, undefined, true],
    [403, undefined, true],
    [429, undefined, true],
    [503, 'challenge', true],
    [503, undefined, false],
    [404, undefined, false],
  ])('classifies HTTP %s (%s)', (status, header, expected) => {
    expect(
      blockedFetch({
        ok: false,
        reason: 'http-error',
        status,
        ...(header ? { responseHeaders: { 'cf-mitigated': header } } : {}),
      }),
    ).toBe(expected);
  });
});
