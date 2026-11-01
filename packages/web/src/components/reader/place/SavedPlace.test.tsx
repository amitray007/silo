import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReadingPositionJson } from '../../../api/types';
import type { ReadAloudApi } from '../listen/useReadAloud';
import type { PencilApi } from '../pencil/usePencil';
import { SavedPlace } from './SavedPlace';

let panel: HTMLElement;
let scroll: HTMLElement;
let prose: HTMLElement;
let tops: number[];
let save: ReturnType<typeof vi.fn<(position: number | null) => Promise<void>>>;
let pencil: PencilApi;
let listen: ReadAloudApi;
const saved: ReadingPositionJson = {
  position: 0.5,
  source: 'mark',
  updatedAt: '2026-11-01T00:00:00Z',
};
const rect = (top: number, height = 30) => new DOMRect(32, top, 300, height);

beforeEach(() => {
  panel = document.createElement('div');
  scroll = document.createElement('div');
  prose = document.createElement('div');
  panel.append(scroll);
  scroll.append(prose);
  document.body.append(panel);
  prose.innerHTML = '<p>One two three four.</p><p>Five six seven eight.</p>';
  tops = [100, 300];
  for (const [i, p] of [...prose.children].entries()) {
    (p as HTMLElement).style.cssText = 'line-height:28px;padding:0px;border:0px;';
    vi.spyOn(p, 'getBoundingClientRect').mockImplementation(() => rect(tops[i] ?? 0));
  }
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 600));
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 600));
  Object.defineProperty(scroll, 'clientHeight', { value: 600 });
  scroll.scrollTo = vi.fn();
  save = vi.fn(async () => {});
  pencil = { startFrom: vi.fn(), stop: vi.fn() } as unknown as PencilApi;
  listen = { startAt: vi.fn(), stop: vi.fn(), forgetPlace: vi.fn() } as unknown as ReadAloudApi;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Range.prototype.getClientRects = function () {
    const node = this.startContainer;
    const block = node instanceof Element ? node : node.parentElement;
    const top = tops[block === prose.children[1] ? 1 : 0] ?? 0;
    return [rect(top, 20)] as unknown as DOMRectList;
  };
});
afterEach(() => {
  vi.useRealTimers();
  panel.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(position: ReadingPositionJson | null = saved) {
  return render(
    <SavedPlace
      prose={prose}
      scroll={scroll}
      panel={panel}
      saved={position}
      onSave={save}
      pencil={pencil}
      listen={listen}
    />,
  );
}

it('B saves the paragraph nearest the top; text entries and modified keys do not write', () => {
  mount(null);
  fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true });
  const input = document.createElement('input');
  document.body.append(input);
  fireEvent.keyDown(input, { key: 'b' });
  input.remove();
  expect(save).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: 'b' });
  expect(save).toHaveBeenCalledWith(0);
});

it('sets a manual mark from the hover outline and removes it through the popover', () => {
  mount(null);
  // jsdom PointerEvent does not carry coordinates, so use a MouseEvent for the native listener.
  act(() =>
    prose.children[1]?.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 310 }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mark reading place' }));
  expect(save).toHaveBeenCalledWith(0.5);
});

it('the ribbon and label open a keyboard popover with Pencil, Listen and Remove', () => {
  mount();
  const label = screen.getByText(/Stopped here/);
  fireEvent.click(label);
  const first = screen.getByRole('button', { name: 'Continue with Pencil' });
  expect(document.activeElement).toBe(first);
  fireEvent.click(first);
  expect(pencil.startFrom).toHaveBeenCalledWith(0.5);
  expect(listen.stop).toHaveBeenCalled();
  fireEvent.click(label);
  fireEvent.click(screen.getByRole('button', { name: 'Listen from here' }));
  expect(listen.startAt).toHaveBeenCalledWith(1);
  fireEvent.click(label);
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(save).toHaveBeenCalledWith(null);
  expect(listen.forgetPlace).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows an offscreen continue pill, jumps to one third, and dismisses with Escape', () => {
  tops[1] = 900;
  const view = mount();
  const pill = screen.getByRole('button', { name: 'Continue reading at 50%' });
  fireEvent.click(pill);
  expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 700, behavior: 'auto' });
  expect(screen.queryByRole('button', { name: 'Continue reading at 50%' })).toBeNull();
  view.unmount();
  mount();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Continue reading at 50%' })).toBeNull();
});

it('dismisses the pill when scrolling past the saved first line', () => {
  tops[1] = 900;
  mount();
  expect(screen.getByRole('button', { name: 'Continue reading at 50%' })).toBeTruthy();
  tops[1] = -80;
  fireEvent.scroll(scroll);
  expect(screen.queryByRole('button', { name: 'Continue reading at 50%' })).toBeNull();
});

it('keeps a pill dismissed when the server replaces an optimistic timestamp', () => {
  tops[1] = 900;
  const view = mount();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  view.rerender(
    <SavedPlace
      prose={prose}
      scroll={scroll}
      panel={panel}
      saved={{ ...saved, position: Math.fround(saved.position), updatedAt: '2026-11-02T00:00:00Z' }}
      onSave={save}
      pencil={pencil}
      listen={listen}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Continue reading at 50%' })).toBeNull();
});

it.each([
  [30000, 30000, 'Just now', '1m ago'],
  [59 * 60000 + 30000, 30000, '59m ago', '1h ago'],
  [2 * 3600000 + 30000, 3600000 - 30000, '2h ago', '3h ago'],
  [3 * 86400000 + 30000, 86400000 - 30000, '3d ago', '4d ago'],
] as const)('updates the label at its next boundary for age %s', (age, delay, before, after) => {
  vi.useFakeTimers();
  const now = Date.parse('2026-11-10T12:00:00Z');
  vi.setSystemTime(now);
  const view = mount({ ...saved, updatedAt: new Date(now - age).toISOString() });
  expect(screen.getByText(`Stopped here · ${before}`)).toBeTruthy();
  act(() => vi.advanceTimersByTime(delay - 1));
  expect(screen.getByText(`Stopped here · ${before}`)).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText(`Stopped here · ${after}`)).toBeTruthy();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
