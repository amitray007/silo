import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HighlightJson } from '../../../api/types';
import { NotePopover } from './NotePopover';
import type { ResolvedHighlight } from './useHighlightLayer';

let restore = () => {};
let scroll: HTMLElement;
let container: HTMLElement;

function resolved(
  id: string,
  start: number,
  end: number,
  color: HighlightJson['color'],
  note: string | null = null,
): ResolvedHighlight {
  const text = document.querySelector('p')?.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const highlight: HighlightJson = {
    id,
    quote: text.data.slice(start, end),
    prefix: '',
    suffix: '',
    startOffset: start,
    endOffset: end,
    color,
    note,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  return { id, start, end, color, highlight, range, how: 'offsets' };
}

beforeEach(() => {
  document.body.innerHTML =
    '<div id="scroll"><p>The quick brown fox jumps over</p></div><div id="host"></div>';
  scroll = document.getElementById('scroll') as HTMLElement;
  container = document.getElementById('host') as HTMLElement;
  const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  restore = () => {
    if (original) Object.defineProperty(Range.prototype, 'getClientRects', original);
    else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  };
  Range.prototype.getClientRects = () =>
    [
      { left: 100, top: 40, right: 200, bottom: 60, width: 100, height: 20 },
    ] as unknown as DOMRectList;
});
afterEach(() => restore());

function setup(item = resolved('a', 4, 9, 'yellow'), all: ResolvedHighlight[] = [item]) {
  const props = {
    onRecolor: vi.fn(),
    onSetNote: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <NotePopover item={item} all={all} scroll={scroll} container={container} {...props} />,
  );
  return { ...props, view };
}

it('opens 280px wide under the passage, with the field focused', () => {
  setup();
  const dialog = screen.getByRole('dialog', { name: 'Note' });
  expect(dialog.style.top).toBe('66px');
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Note' }));
});

it('saves a changed note on blur, and only then', () => {
  const props = setup();
  const field = screen.getByRole('textbox', { name: 'Note' });
  fireEvent.blur(field);
  expect(props.onSetNote).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: 'why this matters' } });
  fireEvent.blur(field);
  expect(props.onSetNote).toHaveBeenCalledWith('a', 'why this matters');
});

it('saves an edited note when the popover closes', () => {
  const props = setup();
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'draft' } });
  props.view.unmount();
  expect(props.onSetNote).toHaveBeenCalledWith('a', 'draft');
});

it('Enter closes, Shift+Enter keeps writing, Escape closes', () => {
  const props = setup();
  const field = screen.getByRole('textbox', { name: 'Note' });
  fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(props.onClose).toHaveBeenCalledTimes(2);
});

it('closes on a press outside, but not on a press inside the popover or on the passage', () => {
  const props = setup();
  fireEvent.mouseDown(screen.getByRole('dialog'));
  fireEvent.mouseDown(document.body, { clientX: 150, clientY: 50 });
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.mouseDown(document.body, { clientX: 600, clientY: 400 });
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it('disables colours used by an overlapping highlight, but not its own', () => {
  const mine = resolved('a', 4, 15, 'yellow');
  const other = resolved('b', 10, 20, 'green');
  const apart = resolved('c', 22, 28, 'blue');
  setup(mine, [mine, other, apart]);
  const dot = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
  expect(dot('green').disabled).toBe(true);
  expect(dot('blue').disabled).toBe(false);
  expect(dot('yellow').disabled).toBe(false);
});

it('enables every colour when all five are taken', () => {
  const mine = resolved('a', 0, 20, 'yellow');
  const others = (['yellow', 'green', 'blue', 'pink', 'violet'] as const).map((color, i) =>
    resolved(`o${i}`, 5 + i, 15, color),
  );
  setup(mine, [mine, ...others]);
  for (const name of ['green', 'blue', 'pink', 'violet'])
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
});

it('recolours through the dots', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'violet' }));
  expect(props.onRecolor).toHaveBeenCalledWith('a', 'violet');
});

it('deletes without saving the draft note', () => {
  const props = setup(resolved('a', 4, 9, 'yellow', 'old'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'unsaved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete highlight' }));
  expect(props.onDelete).toHaveBeenCalledWith('a');
  expect(props.onClose).toHaveBeenCalled();
  props.view.unmount();
  expect(props.onSetNote).not.toHaveBeenCalled();
});
