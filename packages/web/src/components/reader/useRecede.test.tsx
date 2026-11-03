import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRecede } from './useRecede';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe({ passage, chat, range }: { passage: boolean; chat: boolean; range?: Range }) {
  const host = document.getElementById('host');
  useRecede(host, 'passage', passage, range);
  useRecede(host, 'chat', chat);
  return null;
}

const pane = () => document.querySelector('.silo-readerpane') as HTMLElement;

it('lets chat paint before making its backdrop and cancels a folded pending open', () => {
  document.body.innerHTML =
    '<section class="silo-readerpane"><div class="silo-reader-scroll"><article class="silo-reader"><p id="host">Body</p></article></div></section>';
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  const advance = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  };
  const view = render(<Probe passage={false} chat />);
  expect(document.querySelector('.silo-reader-recede')).toBeNull();
  advance();
  expect(document.querySelector('.silo-reader-recede')).toBeNull();
  view.rerender(<Probe passage={false} chat={false} />);
  advance();
  expect(document.querySelector('.silo-reader-recede')).toBeNull();
  view.rerender(<Probe passage={false} chat />);
  advance();
  advance();
  expect(pane().getAttribute('data-recede')).toBe('chat');
  expect(document.querySelectorAll('.silo-reader-recede')).toHaveLength(1);
  view.unmount();
});

it('starts chat recede at once under reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<section class="silo-readerpane"><div id="host"></div></section>';
  const view = render(<Probe passage={false} chat />);
  expect(pane().getAttribute('data-recede')).toBe('chat');
  view.unmount();
});

it('marks the reader pane while a reason holds, and clears it when the last reason ends', () => {
  document.body.innerHTML = '<section class="silo-readerpane"><div id="host"></div></section>';
  const view = render(<Probe passage={false} chat={false} />);
  expect(pane().hasAttribute('data-recede')).toBe(false);
  view.rerender(<Probe passage chat={false} />);
  expect(pane().getAttribute('data-recede')).toBe('passage');
  view.rerender(<Probe passage chat />);
  expect(pane().getAttribute('data-recede')).toBe('passage chat');
  view.rerender(<Probe passage={false} chat />);
  expect(pane().getAttribute('data-recede')).toBe('chat');
  view.unmount();
  expect(pane().hasAttribute('data-recede')).toBe(false);
});

it('drops the blur and the transition under reduced motion', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/reader-recede.css'), 'utf8');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced).toContain('transition: none');
  expect(css).not.toContain('text-shadow:');
  expect(reduced).toContain('filter: none');
});

it('shares one layer, keeps the passage clear, and waits for the final reason to close', async () => {
  document.body.innerHTML =
    '<section class="silo-readerpane"><div class="silo-reader-scroll"><article class="silo-reader"><p id="host">Selected words</p></article></div></section>';
  const scroll = document.querySelector<HTMLElement>('.silo-reader-scroll')!;
  const article = document.querySelector<HTMLElement>('.silo-reader')!;
  Object.defineProperties(scroll, { clientWidth: { value: 640 }, clientHeight: { value: 300 } });
  scroll.scrollTop = 200;
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 100, 640, 300));
  vi.spyOn(article, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, -100, 640, 1000));
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('host')!);
  Object.assign(range, {
    getClientRects: () => [new DOMRect(20, 130, 100, 20), new DOMRect(40, 130, 80, 20)],
  });
  const view = render(<Probe passage chat={false} range={range} />);
  const layer = document.querySelector<HTMLElement>('.silo-reader-recede')!;
  expect(layer.getAttribute('aria-hidden')).toBe('true');
  expect(layer.style.height).toBe('1000px');
  expect(layer.style.clipPath).toContain('M10 230H110V250H10Z');
  view.rerender(<Probe passage chat range={range} />);
  expect(document.querySelectorAll('.silo-reader-recede')).toHaveLength(1);
  view.rerender(<Probe passage={false} chat range={range} />);
  expect(pane().getAttribute('data-recede')).toBe('chat');
  expect(layer.style.clipPath).toBe('none');
  view.unmount();
  expect(pane().hasAttribute('data-recede')).toBe(false);
  await waitFor(() => expect(document.querySelector('.silo-reader-recede')).toBeNull());
});

it('updates the cut-out for typography changes and lets scrolling carry it without measuring', async () => {
  document.body.innerHTML =
    '<section class="silo-readerpane"><div class="silo-reader-scroll"><article class="silo-reader"><p id="host">Selected words</p></article></div></section>';
  const scroll = document.querySelector<HTMLElement>('.silo-reader-scroll')!;
  const article = document.querySelector<HTMLElement>('.silo-reader')!;
  Object.defineProperties(scroll, { clientWidth: { value: 640 }, clientHeight: { value: 300 } });
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 300));
  const bounds = vi
    .spyOn(article, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 640, 1000));
  const rects = vi.fn(() => [new DOMRect(20, 130, 100, 20)]);
  const range = Object.assign(document.createRange(), { getClientRects: rects });
  range.selectNodeContents(document.getElementById('host')!);
  const view = render(<Probe passage chat={false} range={range} />);
  const layer = document.querySelector<HTMLElement>('.silo-reader-recede')!;
  const reads = rects.mock.calls.length;
  scroll.scrollTop = 200;
  scroll.dispatchEvent(new Event('scroll'));
  expect(rects).toHaveBeenCalledTimes(reads);
  expect(layer.style.clipPath).toContain('M20 130H120V150H20Z');
  rects.mockReturnValue([new DOMRect(20, 30, 120, 22)]);
  bounds.mockReturnValue(new DOMRect(0, -200, 640, 1400));
  article.style.fontSize = '20px';
  await waitFor(() => expect(layer.style.height).toBe('1400px'));
  expect(layer.style.clipPath).toContain('M20 230H140V252H20Z');
  view.unmount();
});
