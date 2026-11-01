import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LinkJson } from '../../../api/types';
import { makeLink } from '../../../test/fixtures';
import { DockHostContext } from '../dock/ReaderDock';
import { ReaderContent } from '../ReaderContent';

/**
 * The pencil end to end through the Reader: real prose, a real dock, a faked clock, and layout
 * stubbed to ten 20px lines 100px apart (jsdom does no layout). Each line holds 8 of 80 words.
 */
const LINE_TOP = (index: number) => 60 + index * 100;
const GUIDE_Y = (index: number) => LINE_TOP(index) + 21; // under the line: top + height + 1

const html = Array.from(
  { length: 10 },
  (_, i) => `<p>line${i} two three four five six seven eight</p>`,
).join('');
const reader = { capturedAt: null, contentHtml: html, contentImages: [] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let failPuts = 0;
let puts: Array<{ url: string; body: { position: number }; keepalive: boolean }>;
let scrollArea: HTMLDivElement;
let restoreRects = () => {};

function stubLayout() {
  const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  restoreRects = () => {
    if (original) Object.defineProperty(Range.prototype, 'getClientRects', original);
    else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  };
  Range.prototype.getClientRects = function (this: Range) {
    const block = this.startContainer.parentElement;
    const index = block ? Array.from(block.parentElement?.children ?? []).indexOf(block) : 0;
    const top = LINE_TOP(index);
    return [
      { left: 0, top, width: 200, height: 20, right: 200, bottom: top + 20 },
    ] as unknown as DOMRectList;
  };
}

function Host({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [scroll, setScroll] = useState<HTMLElement | null>(null);
  return (
    <DockHostContext.Provider value={{ element: host, scroll, panel: scroll, report: () => {} }}>
      <div
        ref={(element) => {
          if (element) {
            Object.defineProperty(element, 'clientHeight', { value: 600, configurable: true });
            element.scrollTo = vi.fn();
            scrollArea = element as HTMLDivElement;
          }
          setScroll(element);
        }}
      >
        {children}
      </div>
      <div ref={setHost} />
    </DockHostContext.Provider>
  );
}

async function open(link: LinkJson = makeLink({ id: 'pencil' })) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Host>
        <ReaderContent link={link} />
      </Host>
    </QueryClientProvider>,
  );
  await screen.findByText(/line0/);
  await screen.findByRole('toolbar', { name: 'Reader tools' });
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
    ],
  });
}

const pencilButton = () => screen.getByRole('button', { name: 'Pencil' });
const guide = () => document.querySelector<HTMLElement>('.silo-pencil');
const guideY = () => Number(/, (-?[\d.]+)px/.exec(guide()?.style.transform ?? '')?.[1]);
const press = (key: string, target: Element = document.body, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, ...init });
const settle = () => act(async () => vi.advanceTimersByTimeAsync(0));
const play = (seconds: number) => act(() => vi.advanceTimersByTime(seconds * 1000));
const saved = (position: number, at: number) =>
  expect(Math.abs((puts[at]?.body.position ?? 9) - position)).toBeLessThan(0.006);

beforeEach(() => {
  localStorage.clear();
  puts = [];
  failPuts = 0;
  stubLayout();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        puts.push({ url, body, keepalive: Boolean(init.keepalive) });
        if (failPuts > 0) {
          failPuts -= 1;
          return json({ error: 'internal_error', message: 'boom' }, 500);
        }
        return json({
          readingPosition: {
            source: 'pencil',
            position: body.position,
            updatedAt: '2026-11-01T00:00:00Z',
          },
        });
      }
      return url.endsWith('/reader') ? json(reader) : json({ error: 'not_found' }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreRects();
  localStorage.clear();
  for (const stray of document.querySelectorAll('input, textarea, [role]')) stray.remove();
});

it('sweeps a line in words / wpm seconds, then drops to the next', async () => {
  await open();
  fireEvent.click(pencilButton());
  expect(pencilButton().closest('.silo-reader-dock-split')?.getAttribute('data-on')).toBe('true');
  expect(guideY()).toBe(GUIDE_Y(0));
  play(1);
  expect(guideY()).toBe(GUIDE_Y(0));
  play(1.2); // 8 words at 240 wpm is 2 seconds
  expect(guideY()).toBe(GUIDE_Y(1));
});

it('follows the pace setting', async () => {
  localStorage.setItem('silo.readerPencil', JSON.stringify({ v: 1, wpm: 480 }));
  await open();
  fireEvent.click(pencilButton());
  play(1.1); // 8 words at 480 wpm is 1 second
  expect(guideY()).toBe(GUIDE_Y(1));
});

it('saves the position when it pauses', async () => {
  await open();
  fireEvent.click(pencilButton());
  play(1);
  press(' ');
  expect(puts).toHaveLength(1);
  expect(puts[0]?.url).toBe('/api/links/pencil/reading-position');
  saved(0.05, 0); // half of line 0's 8 of 80 words
  expect(puts[0]?.keepalive).toBe(false);
  const frozen = guideY();
  play(5);
  expect(guideY()).toBe(frozen);
});

it('saves when the pencil is turned off', async () => {
  await open();
  fireEvent.click(pencilButton());
  play(1);
  fireEvent.click(pencilButton());
  expect(guide()).toBeNull();
  expect(puts).toHaveLength(1);
});

it('saves every 10 seconds while playing, and not in between', async () => {
  localStorage.setItem('silo.readerPencil', JSON.stringify({ v: 1, wpm: 100 }));
  await open();
  fireEvent.click(pencilButton());
  play(9);
  expect(puts).toHaveLength(0);
  play(2); // 11s
  expect(puts).toHaveLength(1);
  await settle(); // one request at a time: the next waits for this one to land
  play(10); // 21s
  expect(puts).toHaveLength(2);
  saved(((20 / 60) * 100) / 80, 1); // at 100 wpm, 20 seconds read 33 of the 80 words
});

it('sends a keepalive save as the page hides', async () => {
  await open();
  fireEvent.click(pencilButton());
  play(1);
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(puts).toHaveLength(1);
  expect(puts[0]?.keepalive).toBe(true);
});

it('does not save for a feed post', async () => {
  await open(makeLink({ id: 'feed', feedId: 'feed-1' }));
  fireEvent.click(pencilButton());
  play(1);
  press(' ');
  expect(puts).toHaveLength(0);
});

it('replaces the right-gutter resume button with a ribbon and P resumes its word line', async () => {
  await open(
    makeLink({
      id: 'resume',
      readingPosition: { position: 0.5, source: 'mark', updatedAt: '2026-11-01T00:00:00Z' },
    }),
  );
  expect(screen.queryByRole('button', { name: 'Resume reading' })).toBeNull();
  expect(document.querySelector('.silo-place-ribbon')).not.toBeNull();
  expect(guide()).toBeNull();
  press('p');
  expect(guideY()).toBe(GUIDE_Y(5));
  play(2.1);
  expect(guideY()).toBe(GUIDE_Y(6));
});

it('shows no resume button when nothing is saved or the article was finished', async () => {
  await open();
  expect(screen.queryByRole('button', { name: 'Resume reading' })).toBeNull();
});

it('shows no resume button for a finished article', async () => {
  await open(
    makeLink({
      id: 'done',
      readingPosition: { source: 'pencil', position: 1, updatedAt: '2026-11-01T00:00:00Z' },
    }),
  );
  expect(screen.queryByRole('button', { name: 'Resume reading' })).toBeNull();
});

it('toggles with p and moves a line with the arrows', async () => {
  await open();
  press('p');
  expect(guideY()).toBe(GUIDE_Y(0));
  press('ArrowDown');
  press('ArrowDown');
  expect(guideY()).toBe(GUIDE_Y(2));
  press('ArrowUp');
  expect(guideY()).toBe(GUIDE_Y(1));
  press('ArrowUp');
  press('ArrowUp');
  expect(guideY()).toBe(GUIDE_Y(0));
  press('p');
  expect(guide()).toBeNull();
});

it('plays and pauses with Space while on, and changes speed with + and -', async () => {
  await open();
  press('p');
  press(' '); // pause: p started it playing
  const still = guideY();
  play(3);
  expect(guideY()).toBe(still);
  press(' ');
  play(2.1);
  expect(guideY()).toBe(GUIDE_Y(1));
  press('+');
  expect(JSON.parse(localStorage.getItem('silo.readerPencil') ?? '{}').wpm).toBe(260);
  press('-');
  press('-');
  expect(JSON.parse(localStorage.getItem('silo.readerPencil') ?? '{}').wpm).toBe(220);
});

it('ignores its keys in inputs and textareas', async () => {
  await open();
  for (const tag of ['input', 'textarea']) {
    const field = document.createElement(tag);
    document.body.append(field);
    field.focus();
    press('p', field);
    expect(guide()).toBeNull();
    field.remove();
  }
  press('p');
  const field = document.createElement('input');
  document.body.append(field);
  field.focus();
  press('ArrowDown', field);
  press(' ', field);
  press('+', field);
  expect(guideY()).toBe(GUIDE_Y(0));
  expect(localStorage.getItem('silo.readerPencil')).toBeNull();
  field.remove();
});

it('ignores its keys beside another dialog or menu', async () => {
  await open();
  press('p');
  for (const role of ['dialog', 'alertdialog', 'menu']) {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', role);
    document.body.append(overlay);
    press('ArrowDown');
    press('Escape');
    expect(guideY()).toBe(GUIDE_Y(0));
    expect(guide()).not.toBeNull();
    overlay.remove();
  }
  press('ArrowDown');
  expect(guideY()).toBe(GUIDE_Y(1));
});

it('takes the arrow keys from the Reader while on, and leaves its keys alone while off', async () => {
  await open();
  const readerKeys = vi.fn();
  document.addEventListener('keydown', readerKeys);
  press('ArrowDown');
  press('j');
  expect(readerKeys.mock.calls.map(([event]) => event.key)).toEqual(['ArrowDown', 'j']);
  readerKeys.mockClear();
  press('p');
  readerKeys.mockClear();
  press('ArrowDown');
  expect(readerKeys).not.toHaveBeenCalled();
  document.removeEventListener('keydown', readerKeys);
});

it('turns off with Escape only after the open sheet closes', async () => {
  await open();
  press('p');
  fireEvent.click(screen.getByRole('button', { name: 'Pencil settings' }));
  expect(screen.getByRole('dialog', { name: 'Pencil' })).toBeDefined();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Pause pencil' }), { key: 'Escape' });
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.queryByRole('dialog', { name: 'Pencil' })).toBeNull();
  expect(guide()).not.toBeNull();
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  press('Escape');
  expect(guide()).toBeNull();
  expect(outer).not.toHaveBeenCalled(); // the Reader never sees the key that turned the pencil off
  press('Escape');
  expect(outer).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', outer);
});

it('moves to the clicked line while on', async () => {
  await open();
  const lines = document.querySelectorAll('.silo-reader-prose p');
  fireEvent.click(lines[2] as Element, { clientY: LINE_TOP(2) + 10 });
  expect(guide()).toBeNull(); // off: a click does nothing
  press('p');
  fireEvent.click(lines[3] as Element, { clientY: LINE_TOP(3) + 10 });
  expect(guideY()).toBe(GUIDE_Y(3));
  fireEvent.click(lines[3] as Element, { clientY: 5000 });
  expect(guideY()).toBe(GUIDE_Y(3)); // too far from any line
});

it('keeps the line in view with a smooth scroll', async () => {
  await open(
    makeLink({
      id: 'far',
      readingPosition: { source: 'pencil', position: 0.95, updatedAt: '2026-11-01T00:00:00Z' },
    }),
  );
  press('p');
  expect(scrollArea.scrollTo).toHaveBeenCalledWith({ top: LINE_TOP(9) - 240, behavior: 'smooth' });
});

it('jumps instead of scrolling smoothly with reduced motion', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  await open(
    makeLink({
      id: 'far',
      readingPosition: { source: 'pencil', position: 0.95, updatedAt: '2026-11-01T00:00:00Z' },
    }),
  );
  press('p');
  expect(scrollArea.scrollTo).toHaveBeenCalledWith({ top: LINE_TOP(9) - 240, behavior: 'auto' });
});

it('draws a Highlighter band when that style is chosen', async () => {
  localStorage.setItem('silo.readerPencil', JSON.stringify({ v: 1, style: 'highlighter' }));
  await open();
  press('p');
  expect(guide()?.getAttribute('data-style')).toBe('highlighter');
  expect(guide()?.style.height).toBe('24px'); // the line's 20px plus 2px above and below
});

it('retries a failed save on the next pause or stop', async () => {
  await open();
  failPuts = 1;
  fireEvent.click(pencilButton());
  play(1);
  press(' '); // pause: the save fails
  await settle();
  expect(puts).toHaveLength(1);
  fireEvent.click(pencilButton()); // stop at the same place: it is sent again
  await settle();
  expect(puts).toHaveLength(2);
  expect(puts[1]?.body.position).toBeCloseTo(puts[0]?.body.position ?? -1, 5);
});

it('does not send the same position twice once the server confirmed it', async () => {
  await open();
  fireEvent.click(pencilButton());
  play(1);
  press(' ');
  await settle();
  expect(puts).toHaveLength(1);
  fireEvent.click(pencilButton());
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  await settle();
  expect(puts).toHaveLength(1);
});

it('sends a keepalive save on pagehide when the server has not confirmed the position', async () => {
  await open();
  failPuts = 1;
  fireEvent.click(pencilButton());
  play(1);
  press(' ');
  await settle(); // the save failed, so the server still has nothing
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(puts).toHaveLength(2);
  expect(puts[1]?.keepalive).toBe(true);
});

it('redraws the guide when the style changes while paused', async () => {
  await open();
  press('p');
  press(' ');
  expect(guide()?.getAttribute('data-style')).toBe('underline');
  expect(guide()?.style.height).toBe('2px');
  act(() => {
    localStorage.setItem('silo.readerPencil', JSON.stringify({ v: 1, style: 'highlighter' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'silo.readerPencil' }));
  });
  expect(guide()?.getAttribute('data-style')).toBe('highlighter');
  expect(guide()?.style.height).toBe('24px');
});

it('toggles once for a held Space', async () => {
  await open();
  press('p');
  const first = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  const held = new KeyboardEvent('keydown', {
    key: ' ',
    bubbles: true,
    cancelable: true,
    repeat: true,
  });
  act(() => {
    document.body.dispatchEvent(first);
    document.body.dispatchEvent(held);
    document.body.dispatchEvent(held);
  });
  const stopped = guideY();
  play(3);
  expect(guideY()).toBe(stopped); // paused once, not paused and played again
  expect(held.defaultPrevented).toBe(true); // and the page did not scroll
});

it('resumes a saved place at the end of the article', async () => {
  await open(
    makeLink({
      id: 'done',
      readingPosition: { source: 'pencil', position: 1, updatedAt: '2026-11-01T00:00:00Z' },
    }),
  );
  press('p');
  expect(guideY()).toBe(GUIDE_Y(9));
});

it('keeps the saved ribbon on the phone and removes the old resume button', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 640px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  await open(
    makeLink({
      id: 'phone',
      readingPosition: { source: 'pencil', position: 0.5, updatedAt: '2026-11-01T00:00:00Z' },
    }),
  );
  expect(document.querySelector('.silo-place-ribbon')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Resume reading' })).toBeNull();
});
