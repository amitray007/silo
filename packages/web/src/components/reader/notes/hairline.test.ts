import { afterEach, expect, it, vi } from 'vitest';
import { hairlinePath } from './hairline';

function fixture() {
  const frame = document.createElement('div');
  frame.innerHTML =
    '<div data-group="p1"><div class="silo-lgroup-scroll"><div data-note="a"></div></div></div>';
  const group = frame.firstElementChild as HTMLElement;
  const scroller = group.firstElementChild as HTMLElement;
  const target = scroller.firstElementChild as HTMLElement;
  vi.spyOn(frame, 'clientWidth', 'get').mockReturnValue(636);
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 636, 800));
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 264, 112));
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 264, 112));
  vi.spyOn(scroller, 'scrollHeight', 'get').mockReturnValue(400);
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 120, 264, 40));
  const readRange = vi.fn(() => [new DOMRect(0, 240, 100, 20)]);
  const range = Object.assign(document.createRange(), { getClientRects: readRange });
  return { frame, target, scroller, range, readRange };
}

afterEach(() => vi.restoreAllMocks());

it('keeps the origin on the exact range and projects the pending group move before writes', () => {
  const { frame, target, range, readRange } = fixture();
  const next = new Map([['p1', { top: 200, max: 112, height: 112 }]]);
  expect(hairlinePath(frame, target, range, 36, next, 350)).toBe(
    'M672 350C677 350 677 232 682 232',
  );
  expect(readRange).not.toHaveBeenCalled();
  expect(target.parentElement?.style.maxHeight).toBe('');
  expect(hairlinePath(frame, target, range, 36)).toBe('M672 250C677 250 677 132 682 132');
  expect(readRange).toHaveBeenCalledOnce();
});

it('accounts for scrollTop clamping when the pending cap grows', () => {
  const { frame, target, scroller, range } = fixture();
  scroller.scrollTop = 200;
  const next = new Map([['p1', { top: 200, max: 300, height: 300 }]]);
  expect(hairlinePath(frame, target, range, 36, next, 350)).toBe(
    'M672 350C677 350 677 332 682 332',
  );
});

it('hides a block outside the projected viewport without measuring its range', () => {
  const { frame, target, range, readRange } = fixture();
  vi.mocked(target.getBoundingClientRect).mockReturnValue(new DOMRect(0, 40, 264, 40));
  const next = new Map([['p1', { top: 200, max: 112, height: 112 }]]);
  expect(hairlinePath(frame, target, range, 36, next)).toBe('');
  expect(readRange).not.toHaveBeenCalled();
});
