import { describe, expect, it } from 'vitest';
import { allowsFraming } from './policy.js';

const page = 'https://publisher.test/article';
const origin = 'https://silo.test';

describe('frame policy', () => {
  it.each([
    [undefined, undefined, true],
    [undefined, 'DENY', false],
    [undefined, 'SAMEORIGIN', false],
    [undefined, 'sameorigin, nonsense', false],
    [undefined, 'nonsense, DENY', false],
    [undefined, 'DENY, SAMEORIGIN', false],
    [undefined, 'ALLOW-FROM https://silo.test', false],
    [undefined, 'unknown', true],
    ["default-src 'none'", undefined, true],
    ["default-src 'none'", 'DENY', false],
    ["frame-ancestors 'none'", undefined, false],
    ["frame-ancestors 'self'", undefined, false],
    ['frame-ancestors https://silo.test', 'DENY', true],
    ['frame-ancestors https://silo.test', 'ALLOW-FROM https://bad.test', true],
    ['frame-ancestors https://silo.test', 'DENY, SAMEORIGIN', true],
    ['frame-ancestors https://bad.test', undefined, false],
    ['frame-ancestors *', 'DENY', true],
    ['frame-ancestors https:', undefined, true],
    ['frame-ancestors http:', undefined, true],
    ['frame-ancestors ftp:', undefined, false],
    ['frame-ancestors https://*.test', undefined, true],
    ['frame-ancestors https://*.silo.test', undefined, false],
    ['frame-ancestors https://silo.test.evil.test', undefined, false],
    ['frame-ancestors silo.test', undefined, true],
    ['FRAME-ANCESTORS HTTPS://SILO.TEST', undefined, true],
    ['frame-ancestors https://silo.test:443', undefined, true],
    ['frame-ancestors https://silo.test:80', undefined, false],
    ['frame-ancestors https://silo.test:0443', undefined, true],
    ['frame-ancestors https://silo.test/private', undefined, false],
    ['frame-ancestors https://silo.test/', undefined, true],
    ['frame-ancestors https://silo.test:8443', undefined, false],
    ['frame-ancestors https://silo.test:*', undefined, true],
    ['frame-ancestors', undefined, false],
    ["frame-ancestors 'none'; frame-ancestors *", undefined, false],
    ["frame-ancestors *; frame-ancestors 'none'", undefined, true],
    ["frame-ancestors *, frame-ancestors 'none'", undefined, false],
    ['frame-ancestors https://silo.test, frame-ancestors https:', undefined, true],
    ["default-src 'none', frame-ancestors https://silo.test", 'DENY', true],
  ])('CSP %s, XFO %s -> %s', (csp, xfo, allowed) => {
    expect(
      allowsFraming(
        { ...(csp ? { contentSecurityPolicy: csp } : {}), ...(xfo ? { xFrameOptions: xfo } : {}) },
        page,
        origin,
      ),
    ).toBe(allowed);
  });

  it.each([
    ['https://silo.test:5175', 'https://silo.test', false],
    ['https://silo.test:5175', 'https://silo.test:*', true],
    ['http://localhost:5175', 'http://localhost:5175', true],
    ['http://localhost:5176', 'http://localhost:5175', false],
    ['http://silo.test', 'https://silo.test', false],
    ['https://a.silo.test', 'https://*.silo.test', true],
    ['https://silo.test', 'https://*.silo.test', false],
    ['https://evilsilo.test', 'https://*.silo.test', false],
  ])('origin %s matches %s -> %s', (ancestor, source, allowed) => {
    expect(
      allowsFraming({ contentSecurityPolicy: `frame-ancestors ${source}` }, page, ancestor),
    ).toBe(allowed);
  });

  it('allows a case-insensitive self upgrade on default ports', () => {
    expect(
      allowsFraming(
        { contentSecurityPolicy: "frame-ancestors 'SELF'" },
        'http://silo.test/article',
        'https://silo.test',
      ),
    ).toBe(true);
    expect(
      allowsFraming(
        { contentSecurityPolicy: "frame-ancestors 'self'" },
        'https://silo.test/article',
        'http://silo.test',
      ),
    ).toBe(false);
  });

  it('matches self and single SAMEORIGIN against the final page origin', () => {
    expect(
      allowsFraming(
        { contentSecurityPolicy: "frame-ancestors 'self'" },
        page,
        'https://publisher.test',
      ),
    ).toBe(true);
    expect(allowsFraming({ xFrameOptions: 'SAMEORIGIN' }, page, 'https://publisher.test')).toBe(
      true,
    );
    expect(
      allowsFraming({ xFrameOptions: 'SAMEORIGIN, invalid' }, page, 'https://publisher.test'),
    ).toBe(false);
  });
});
