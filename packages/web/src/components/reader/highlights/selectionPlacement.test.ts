import { afterEach, beforeEach, expect, it } from 'vitest';
import { surfacePlacement, type TouchStrip } from './selectionPlacement';

const rect = (top: number, bottom: number) =>
  ({ top, bottom, left: 100, width: 80, height: bottom - top }) as DOMRect;
const strip: TouchStrip = { bottom: 640, headerBottom: 56, centerX: 180 };
const size = { w: window.innerWidth, h: window.innerHeight };

beforeEach(() => {
  Object.assign(window, { innerWidth: 360, innerHeight: 740 });
});
afterEach(() => {
  Object.assign(window, { innerWidth: size.w, innerHeight: size.h });
});

it('keeps the bar 12px above the selection with a fine pointer', () => {
  const p = surfacePlacement(rect(300, 330), 'bar');
  expect(p).toMatchObject({ flip: false, strip: false, top: 288 });
});

it('puts the bar in the strip above the dock with a coarse pointer', () => {
  const p = surfacePlacement(rect(300, 330), 'bar', strip);
  expect(p).toMatchObject({ flip: false, strip: true, top: 640, left: 180 });
});

it('puts the bar under the header when the selection sits in the strip', () => {
  const p = surfacePlacement(rect(600, 630), 'bar', strip);
  expect(p).toMatchObject({ flip: true, strip: true, top: 64 });
});

it('leaves the composer and answer by the selection', () => {
  expect(surfacePlacement(rect(300, 330), 'composer', strip).strip).toBe(false);
  expect(surfacePlacement(rect(300, 330), 'answer', strip).strip).toBe(false);
});
