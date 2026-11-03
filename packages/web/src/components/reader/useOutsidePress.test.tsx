import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOutsidePress } from './useOutsidePress';

function pointer(target: Element, type = 'pointerdown', init: PointerEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperties(event, {
    pointerType: { value: init.pointerType ?? 'mouse' },
    pointerId: { value: init.pointerId ?? 1 },
  });
  fireEvent(target, event);
  return event;
}

function setup(menu = false) {
  const articlePress = vi.fn();
  const articleClick = vi.fn();
  const chromeClick = vi.fn();
  function Surface() {
    const [open, setOpen] = useState(true);
    const root = useRef<HTMLDivElement>(null);
    useOutsidePress(open, root, () => setOpen(false));
    return (
      <>
        <button type="button" onClick={chromeClick}>
          Sidebar
        </button>
        <div className="silo-reader-scroll" data-testid="scroll">
          <a href="https://example.com/article" onPointerDown={articlePress} onClick={articleClick}>
            Article
          </a>
          <div className="silo-reader-recede" data-testid="backdrop" />
        </div>
        <div className="silo-reader-dock" ref={root}>
          <output>{open ? 'Open' : 'Folded'}</output>
          <textarea aria-label="Composer" />
          <button type="button">Dock</button>
          {menu && (
            <div data-reader-menu>
              <button type="button">History</button>
            </div>
          )}
        </div>
      </>
    );
  }
  const view = render(<Surface />);
  return { ...view, articlePress, articleClick, chromeClick };
}

afterEach(() => {
  fireEvent.pointerDown(document.body);
});

it('consumes only the folding article press and click, and keeps the surface mounted', () => {
  const { articlePress, articleClick } = setup();
  const composer = screen.getByRole('textbox');
  const article = screen.getByRole('link');
  expect(pointer(article).defaultPrevented).toBe(true);
  expect(screen.getByText('Folded')).toBeTruthy();
  expect(screen.getByRole('textbox')).toBe(composer);
  expect(articlePress).not.toHaveBeenCalled();
  expect(fireEvent.click(article, { detail: 1 })).toBe(false);
  expect(articleClick).not.toHaveBeenCalled();
  pointer(article);
  fireEvent.click(article, { detail: 1 });
  expect(articlePress).toHaveBeenCalledOnce();
  expect(articleClick).toHaveBeenCalledOnce();
});

it('lets app chrome act normally after folding', () => {
  const { chromeClick } = setup();
  const chrome = screen.getByRole('button', { name: 'Sidebar' });
  expect(pointer(chrome).defaultPrevented).toBe(false);
  fireEvent.click(chrome);
  expect(screen.getByText('Folded')).toBeTruthy();
  expect(chromeClick).toHaveBeenCalledOnce();
});

it('keeps panel, composer and dock presses inside, and ignores wheel and scrollbar presses', () => {
  setup();
  for (const target of [
    screen.getByText('Open'),
    screen.getByRole('textbox'),
    screen.getByText('Dock'),
    screen.getByTestId('scroll'),
  ])
    pointer(target);
  fireEvent.wheel(screen.getByRole('link'));
  expect(screen.getByText('Open')).toBeTruthy();
});

it('gives an open child popover priority over folding', () => {
  setup(true);
  pointer(screen.getByText('History'));
  pointer(screen.getByRole('link'));
  expect(screen.getByText('Open')).toBeTruthy();
});

it('folds on a touch tap, but keeps touch scrolling and cancellation open', () => {
  setup();
  const article = screen.getByRole('link');
  pointer(article, 'pointerdown', { pointerType: 'touch', clientY: 20 });
  expect(screen.getByText('Open')).toBeTruthy();
  pointer(article, 'pointerup', { pointerType: 'touch', clientY: 80 });
  expect(screen.getByText('Open')).toBeTruthy();
  pointer(article, 'pointerdown', { pointerType: 'touch' });
  fireEvent.scroll(screen.getByTestId('scroll'));
  pointer(article, 'pointerup', { pointerType: 'touch' });
  expect(screen.getByText('Open')).toBeTruthy();
  pointer(article, 'pointerdown', { pointerType: 'touch' });
  pointer(article, 'pointercancel', { pointerType: 'touch' });
  pointer(article, 'pointerup', { pointerType: 'touch' });
  expect(screen.getByText('Open')).toBeTruthy();
  pointer(article, 'pointerdown', { pointerType: 'touch' });
  expect(pointer(article, 'pointerup', { pointerType: 'touch' }).defaultPrevented).toBe(true);
  expect(screen.getByText('Folded')).toBeTruthy();
  expect(fireEvent.click(article, { detail: 1 })).toBe(false);
});

it('folds on the backdrop without waiting for a click', () => {
  setup();
  pointer(screen.getByTestId('backdrop'));
  expect(screen.getByText('Folded')).toBeTruthy();
});
