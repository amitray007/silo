import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReadingPositionJson } from '../../../api/types';
import type { ReadAloudApi } from '../listen/useReadAloud';
import type { PencilApi } from '../pencil/usePencil';
import { SavedPlace } from './SavedPlace';

let panel: HTMLElement;
let scroll: HTMLElement;
let prose: HTMLElement;
let frame: HTMLElement;
let tops: number[];
let observers: {
  elements: Set<Element>;
  notify: () => void;
  disconnect: ReturnType<typeof vi.fn>;
}[];
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
  frame = document.createElement('div');
  frame.className = 'silo-prose-frame';
  panel.append(scroll);
  scroll.append(frame);
  frame.append(prose);
  document.body.append(panel);
  prose.innerHTML = '<p>One two three four.</p><p>Five six seven eight.</p>';
  tops = [100, 300];
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      elements = new Set<Element>();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({
          elements: this.elements,
          notify: () => callback([], this as unknown as ResizeObserver),
          disconnect: this.disconnect,
        });
      }
      observe(element: Element) {
        this.elements.add(element);
      }
    },
  );
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

it('hosts the mark beside the prose and paints a paragraph resize synchronously', () => {
  const view = mount();
  const gutter = frame.querySelector<HTMLElement>('.silo-place-ribbon-gutter');
  const paragraph = prose.children[1];
  expect(gutter?.parentElement).toBe(frame);
  expect(gutter?.style.top).toBe('302px');
  expect(gutter?.style.left).toBe('2px');
  const observer = observers.find((item) => paragraph && item.elements.has(paragraph));
  expect(observer?.elements.has(frame)).toBe(true);
  expect(observer?.elements.has(prose)).toBe(true);
  tops[1] = 380;
  observer?.notify();
  // No act, timer, or animation frame is needed to paint a ResizeObserver measurement.
  expect(gutter?.style.top).toBe('382px');
  expect(gutter?.style.getPropertyValue('--silo-place-row-top')).toBe('-22px');
  view.unmount();
  expect(observer?.disconnect).toHaveBeenCalledOnce();
});

it('moves the ribbon in the same callback that opens the paragraph gap', () => {
  tops[1] = 130;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  mount();
  const gutter = frame.querySelector<HTMLElement>('.silo-place-ribbon-gutter');
  expect(gutter?.style.top).toBe('132px');
  const tick = frames.get(1);
  expect(tick).toBeDefined();
  tick?.(100);
  expect((prose.children[1] as HTMLElement).style.paddingTop).toBe('33.25px');
  expect(gutter?.style.top).toBe('165.25px');
});

it('updates the dial window during the scroll event, without scheduling another frame', () => {
  const cluster = document.createElement('div');
  cluster.className = 'silo-outline-cluster';
  panel.append(cluster);
  vi.spyOn(cluster, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 52, 300));
  mount();
  const ribbon = frame.querySelector('.silo-place-ribbon');
  expect(ribbon).not.toBeNull();
  if (!ribbon) return;
  vi.spyOn(ribbon, 'getBoundingClientRect').mockReturnValue(new DOMRect(2, 188, 24, 24));
  fireEvent.scroll(scroll);
  expect(panel.style.getPropertyValue('--silo-ribbon-clip')).toContain('M 0 77 H 52 V 123 H 0 Z');
});

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
  const label = screen.getByText(/Continue here/);
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

it.each([
  ['mark', 'Continue here'],
  ['pencil', 'Continue here'],
  ['listen', 'Continue listening here'],
] as const)('uses the same label, time and accessible name for source %s', (source, text) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  mount({ ...saved, source });
  const label = `${text} · Yesterday`;
  expect(screen.getByText(label)).toBeTruthy();
  const buttons = screen.getAllByRole('button', { name: label });
  expect(buttons).toHaveLength(2);
  const ribbon = buttons[0];
  if (!ribbon) throw new Error('Expected the saved-place ribbon');
  fireEvent.click(ribbon);
  expect(screen.getByRole('dialog').querySelector('.silo-place-meta')?.textContent).toBe(label);
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
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  fireEvent.scroll(scroll);
  vi.unstubAllGlobals();
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
  expect(screen.getByText(`Continue here · ${before}`)).toBeTruthy();
  act(() => vi.advanceTimersByTime(delay - 1));
  expect(screen.getByText(`Continue here · ${before}`)).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText(`Continue here · ${after}`)).toBeTruthy();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the place menu on unchanged scroll events and closes it on actual movement', () => {
  mount();
  const ribbon = frame.querySelector<HTMLButtonElement>('.silo-place-ribbon');
  if (!ribbon) throw new Error('Missing saved-place ribbon');
  fireEvent.click(ribbon);
  fireEvent.scroll(scroll);
  expect(screen.getByRole('dialog', { name: 'Saved reading place' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(save).toHaveBeenCalledWith(null);

  fireEvent.click(ribbon);
  scroll.scrollTop = 10;
  fireEvent.scroll(scroll);
  expect(screen.queryByRole('dialog', { name: 'Saved reading place' })).toBeNull();

  fireEvent.click(ribbon);
  scroll.scrollLeft = 10;
  fireEvent.scroll(scroll);
  expect(screen.queryByRole('dialog', { name: 'Saved reading place' })).toBeNull();
});
