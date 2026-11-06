import { describe, expect, it } from 'vitest';
import { addParams, domainProblem, normalizeDomain, parseParams } from './linkCleaning';

describe('normalizeDomain', () => {
  it.each([
    ['  YouTube.com ', 'youtube.com'],
    ['https://www.youtube.com/watch?v=1', 'youtube.com'],
    ['http://m.youtube.com:8080/x#y', 'm.youtube.com'],
    ['www.Example.COM/', 'example.com'],
    ['user:pw@example.com', 'example.com'],
    ['example.com.', 'example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe('domainProblem', () => {
  it('accepts a host and refuses empty, malformed, and duplicate input', () => {
    expect(domainProblem('youtube.com', [])).toBeNull();
    expect(domainProblem('', [])).toMatch(/Enter a domain/);
    expect(domainProblem('localhost', [])).toMatch(/not a domain/);
    expect(domainProblem('exa mple.com', [])).toMatch(/not a domain/);
    expect(domainProblem('youtube.com', ['youtube.com'])).toMatch(/already has a rule/);
  });
});

describe('parseParams', () => {
  it('splits on commas and whitespace and drops case-insensitive duplicates', () => {
    expect(parseParams('utm_*, fbclid\ngclid  FBCLID')).toEqual({
      names: ['utm_*', 'fbclid', 'gclid'],
      invalid: [],
    });
  });
  it('flags names the setting refuses', () => {
    expect(parseParams('ok, bad name!, *x, a*b').invalid).toEqual(['name!', '*x', 'a*b']);
  });
});

describe('addParams', () => {
  it('appends new names and skips ones already held', () => {
    expect(addParams(['a'], 'A, b', 10)).toEqual({ list: ['a', 'b'] });
    expect(addParams(['a'], 'a', 10)).toEqual({ problem: 'Already in the list.' });
  });
  it('refuses invalid names without adding the valid ones', () => {
    expect(addParams(['a'], 'b, c!', 10)).toHaveProperty('problem');
  });
  it('refuses an empty entry and a list over its limit', () => {
    expect(addParams([], '  ', 10)).toHaveProperty('problem');
    expect(addParams(['a'], 'b', 1)).toEqual({ problem: 'A list holds at most 1 names.' });
  });
});
