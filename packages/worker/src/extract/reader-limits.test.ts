import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countElements,
  READER_BASE_TIMEOUT_MS,
  READER_MAX_TIMEOUT_MS,
  readerThreadCount,
  readerTimeoutMs,
} from './reader-limits.js';

describe('countElements', () => {
  it('counts opening tags of any case and nothing else', () => {
    expect(countElements('')).toBe(0);
    expect(countElements('<div><P class="a">x</P><br/><IMG src=y></div>')).toBe(4);
    // Closing tags, comments, doctype and a bare "<" in text or script are not elements.
    expect(countElements('<!doctype html><!-- <b> --></p> 1 < 2 <3')).toBe(1);
  });
});

describe('readerTimeoutMs', () => {
  it('keeps the 5 s base for a small page', () => {
    expect(readerTimeoutMs('')).toBe(READER_BASE_TIMEOUT_MS);
    expect(readerTimeoutMs('<p>Hi</p>'.repeat(10))).toBeLessThan(READER_BASE_TIMEOUT_MS + 100);
    expect(readerTimeoutMs('<p>Hi</p>')).toBeGreaterThanOrEqual(READER_BASE_TIMEOUT_MS);
  });

  it('adds 1 ms per element and 4 ms per KB', () => {
    const elements = '<i></i>'.repeat(3_000);
    expect(readerTimeoutMs(elements)).toBe(
      READER_BASE_TIMEOUT_MS + 3_000 + Math.round((elements.length / 1024) * 4),
    );
    // Many bytes, no elements: only the per-KB part applies.
    expect(readerTimeoutMs('x'.repeat(1024 * 1024))).toBe(READER_BASE_TIMEOUT_MS + 4 * 1024);
  });

  it('grows with the page, never shrinks, and stops at the hard cap', () => {
    const sizes = [0, 1_000, 5_000, 10_000, 20_000, 200_000];
    const timeouts = sizes.map((n) => readerTimeoutMs('<p>x</p>'.repeat(n)));
    expect(timeouts).toEqual([...timeouts].sort((a, b) => a - b));
    expect(timeouts.at(-1)).toBe(READER_MAX_TIMEOUT_MS);
    expect(Math.max(...timeouts)).toBeLessThanOrEqual(READER_MAX_TIMEOUT_MS);
  });

  it('gives a page of about 10k elements enough room for the measured 4.6 to 6 s', () => {
    // The HN thread fixture: 613 KB, 10.5k elements.
    const html = `${'<span></span>'.repeat(10_500)}${' '.repeat(613_000 - 10_500 * 13)}`;
    expect(readerTimeoutMs(html)).toBeGreaterThanOrEqual(12_000);
  });
});

describe('readerThreadCount', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults to one fewer than the CPUs, between 1 and 3', () => {
    expect([1, 2, 3, 4, 8, 64].map((cpus) => readerThreadCount({}, cpus))).toEqual([
      1, 1, 2, 3, 3, 3,
    ]);
  });

  it('reads SILO_READER_THREADS as an integer from 1 to 8, ignoring blanks', () => {
    expect(readerThreadCount({ SILO_READER_THREADS: '1' }, 8)).toBe(1);
    expect(readerThreadCount({ SILO_READER_THREADS: ' 6 ' }, 2)).toBe(6);
    expect(readerThreadCount({ SILO_READER_THREADS: '8' }, 2)).toBe(8);
    expect(readerThreadCount({ SILO_READER_THREADS: '  ' }, 4)).toBe(3);
  });

  it('warns and keeps the default for anything else', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['0', '9', '-2', '2.5', 'many', '1e1']) {
      expect(readerThreadCount({ SILO_READER_THREADS: bad }, 4)).toBe(3);
    }
    expect(warn).toHaveBeenCalledTimes(6);
    expect(warn.mock.calls[0]?.[0]).toContain('SILO_READER_THREADS="0"');
  });
});
