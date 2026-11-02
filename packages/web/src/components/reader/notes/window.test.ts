import { expect, it } from 'vitest';
import type { Slot } from './stack';
import { laneWindow } from './window';

it('includes groups crossing either buffer edge and explicit far targets in reading order', () => {
  const slots = new Map<string, Slot>([
    ['above', { top: 20, height: 50, max: 112 }],
    ['edge', { top: 550, height: 50, max: 112 }],
    ['view', { top: 1000, height: 112, max: 112 }],
    ['below', { top: 2201, height: 112, max: 112 }],
    ['target', { top: 9000, height: 112, max: 112 }],
  ]);
  expect(laneWindow(slots, 1000, 400)).toEqual(['edge', 'view']);
  expect(laneWindow(slots, 1000, 400, ['target'])).toEqual(['edge', 'view', 'target']);
});
