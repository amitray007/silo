import { describe, expect, it } from 'vitest';
import { formatCount, formatPostCount } from './formatCount';

describe('formatCount', () => {
  it('shows numbers below 1000 as-is', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(100)).toBe('100');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands with a `k` suffix, dropping a trailing .0', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(10_000)).toBe('10k');
    expect(formatCount(12_000)).toBe('12k');
    expect(formatCount(34_125)).toBe('34.1k');
    expect(formatCount(999_000)).toBe('999k');
  });

  it('abbreviates millions with an `m` suffix', () => {
    expect(formatCount(1_000_000)).toBe('1m');
    expect(formatCount(1_500_000)).toBe('1.5m');
    expect(formatCount(240_760_928)).toBe('240.8m');
  });

  it('falls back to the raw string for a negative or non-finite input', () => {
    expect(formatCount(-5)).toBe('-5');
    expect(formatCount(Number.NaN)).toBe('NaN');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });
});

describe('formatPostCount', () => {
  it('writes counts the way X does, truncating', () => {
    expect(formatPostCount(0)).toBe('0');
    expect(formatPostCount(999)).toBe('999');
    expect(formatPostCount(1000)).toBe('1K');
    expect(formatPostCount(2189)).toBe('2.1K');
    expect(formatPostCount(2999)).toBe('2.9K');
    expect(formatPostCount(15_600)).toBe('15.6K');
    expect(formatPostCount(123_456)).toBe('123K');
    expect(formatPostCount(1_450_000)).toBe('1.4M');
  });
});
