import { describe, expect, it } from 'vitest';
import { formatTweetDate, parseTweetDate } from './tweetDate';

describe('parseTweetDate', () => {
  it('reads X created_at with its offset', () => {
    expect(parseTweetDate('Sat Oct 10 06:36:53 +0000 2026')?.toISOString()).toBe(
      '2026-10-10T06:36:53.000Z',
    );
    expect(parseTweetDate('Mon Jul 06 14:25:00 +0530 2026')?.toISOString()).toBe(
      '2026-07-06T08:55:00.000Z',
    );
  });

  it('accepts ISO and rejects junk', () => {
    expect(parseTweetDate('2025-02-02T23:17:15Z')?.toISOString()).toBe('2025-02-02T23:17:15.000Z');
    expect(parseTweetDate('Sat Foo 10 06:36:53 +0000 2026')).toBeNull();
    expect(parseTweetDate('yesterday')).toBeNull();
    expect(parseTweetDate(undefined)).toBeNull();
  });
});

describe('formatTweetDate', () => {
  it('shows time then date', () => {
    const date = new Date('2026-10-10T06:36:53Z');
    // Newer ICU puts a narrow no-break space before AM.
    expect(formatTweetDate(date, 'en-US', 'UTC').replace(/\s/g, ' ')).toBe(
      '6:36 AM · Oct 10, 2026',
    );
  });
});
