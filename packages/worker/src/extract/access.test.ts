import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { blockedFetch, paywallDeclared, readerAccessObservation } from './access.js';

describe('publisher access', () => {
  it.each([
    ['{"isAccessibleForFree":false}', true],
    ['{"@graph":[{"isAccessibleForFree":false}]}', true],
    ['{"hasPart":[{"isAccessibleForFree":false}]}', true],
    ['{"isAccessibleForFree":"false"}', true],
    // MIT Technology Review writes the Python-style string.
    ['{"isAccessibleForFree":"False"}', true],
    ['{"isAccessibleForFree":"True"}', false],
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

  it.each([
    [{ challenge: true }, 'blocked'],
    [{ access: 'paywalled' as const }, 'paywalled'],
    [{}, null],
    [{ readerFailed: true }, undefined],
  ])('maps a page outcome %o to %s', (outcome, expected) => {
    expect(readerAccessObservation(outcome)).toBe(expected);
  });
});
