import { describe, expect, it } from 'vitest';
import {
  aheadEnough,
  LOOKAHEAD_SECONDS,
  LOOKAHEAD_UNITS,
  START_LEAD,
  sentenceAtTime,
  sentenceTimes,
  startTime,
} from './schedule';

describe('startTime', () => {
  it('continues right after the previous buffer', () => {
    expect(startTime(5, 4.9)).toBe(5);
  });
  it('restarts just after now when audio ran late', () => {
    expect(startTime(3, 4)).toBeCloseTo(4 + START_LEAD);
  });
});

describe('sentenceTimes', () => {
  it('spreads a unit over its sentences by text share', () => {
    const unit = {
      text: 'x',
      pause: 0,
      parts: [
        { seg: 4, chars: 10 },
        { seg: 5, chars: 30 },
      ],
    };
    expect(sentenceTimes(unit, 10, 8)).toEqual([
      { at: 10, seg: 4 },
      { at: 12, seg: 5 },
    ]);
  });
});

describe('sentenceAtTime', () => {
  const timeline = [
    { at: 1, seg: 0 },
    { at: 3, seg: 1 },
    { at: 5, seg: 2 },
  ];
  it('finds the sentence playing now', () => {
    expect(sentenceAtTime(timeline, 0.5)).toBe(-1);
    expect(sentenceAtTime(timeline, 3)).toBe(1);
    expect(sentenceAtTime(timeline, 99)).toBe(2);
  });
});

describe('aheadEnough', () => {
  it('needs both 20 seconds and 3 units', () => {
    expect(aheadEnough(LOOKAHEAD_SECONDS, LOOKAHEAD_UNITS)).toBe(true);
    expect(aheadEnough(LOOKAHEAD_SECONDS, LOOKAHEAD_UNITS - 1)).toBe(false);
    expect(aheadEnough(LOOKAHEAD_SECONDS - 1, LOOKAHEAD_UNITS + 5)).toBe(false);
  });
});
