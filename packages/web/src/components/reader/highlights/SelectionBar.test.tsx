import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectionBar } from './SelectionBar';
import type { PendingSelection } from './useSelectionWatcher';

let prose: HTMLElement;
let pending: PendingSelection;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="prose"><p>First paragraph.</p><p>The second paragraph holds the quote.</p></div><div id="pane"></div>';
  prose = document.getElementById('prose') as HTMLElement;
  const text = prose.querySelectorAll('p')[1]?.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 4);
  range.setEnd(text, 20);
  pending = {
    start: 20,
    end: 36,
    range,
    rect: { left: 300, top: 200, width: 100, height: 20, bottom: 220, right: 400 } as DOMRect,
  };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => vi.restoreAllMocks());

function setup(overrides: Partial<Parameters<typeof SelectionBar>[0]> = {}) {
  const props = {
    pending,
    prose,
    container: document.getElementById('pane') as HTMLElement,
    title: 'An Article',
    color: 'blue' as const,
    blocked: new Set<'yellow' | 'green' | 'blue' | 'pink' | 'violet'>(),
    onHighlight: vi.fn(),
    onPick: vi.fn(),
    onNote: vi.fn(),
    onDismiss: vi.fn(),
    onSearch: vi.fn(),
    onListen: vi.fn(),
    hidden: new Set<string>(),
    ...overrides,
  };
  render(<SelectionBar {...props} />);
  return props;
}

it('renders nothing without a selection', () => {
  setup({ pending: null });
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('shows Highlight with the current colour dot, Note and More', () => {
  setup();
  const toolbar = screen.getByRole('toolbar', { name: 'Selection' });
  expect(toolbar.querySelector('.silo-sb-icon')?.getAttribute('data-color')).toBe('blue');
  expect(screen.getByRole('button', { name: /Highlight/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Note/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
});

it('applies the current colour when Highlight is clicked', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: /Highlight/ }));
  expect(props.onHighlight).toHaveBeenCalledWith('blue');
});

it('opens the colour picker on ArrowUp and a swatch applies its colour', () => {
  const props = setup();
  const button = screen.getByRole('button', { name: /Highlight/ });
  fireEvent.keyDown(button, { key: 'ArrowUp' });
  const group = screen.getByRole('group', { name: 'Highlight colour' });
  fireEvent.click(group.querySelector('[aria-label="pink"]') as Element);
  expect(props.onPick).toHaveBeenCalledWith('pink');
  expect(props.onHighlight).not.toHaveBeenCalled();
});

it('moves between swatches with the arrow keys', () => {
  setup();
  fireEvent.keyDown(screen.getByRole('button', { name: /Highlight/ }), { key: 'ArrowUp' });
  const swatches = screen.getByRole('group', { name: 'Highlight colour' });
  const buttons = swatches.querySelectorAll('button');
  (buttons[0] as HTMLElement).focus();
  fireEvent.keyDown(swatches, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(swatches, { key: 'ArrowLeft' });
  fireEvent.keyDown(swatches, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(buttons[buttons.length - 1]);
});

it('Note asks for a note highlight', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: /Note/ }));
  expect(props.onNote).toHaveBeenCalled();
});

it('More lists Copy quote, Copy text and Search silo with a muted line each', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const items = screen.getAllByRole('menuitem');
  expect(items.map((item) => item.querySelector('strong')?.textContent)).toEqual([
    'Copy quote',
    'Copy text',
    'Search silo',
  ]);
  for (const item of items) expect(item.querySelector('small')?.textContent).toBeTruthy();
});

it('Copy quote writes "text" - Title, ¶n with no link', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Copy quote/ }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('"second paragraph" - An Article, ¶2');
  expect(props.onDismiss).toHaveBeenCalled();
});

it('Copy text writes the plain text', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Copy text/ }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('second paragraph');
});

it('Search silo hands the phrase to the palette, trimmed to 120 characters', () => {
  const long = document.createElement('p');
  long.textContent = 'word '.repeat(60);
  prose.append(long);
  const range = document.createRange();
  range.selectNodeContents(long);
  const onSearch = vi.fn();
  setup({ pending: { ...pending, range }, onSearch });
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Search silo/ }));
  expect(onSearch).toHaveBeenCalledTimes(1);
  expect((onSearch.mock.calls[0]?.[0] as string).length).toBe(120);
});

it('turns off colours used by overlapping highlights in the picker', () => {
  const props = setup({ blocked: new Set(['green', 'pink']) });
  fireEvent.keyDown(screen.getByRole('button', { name: /Highlight/ }), { key: 'ArrowUp' });
  const group = screen.getByRole('group', { name: 'Highlight colour' });
  const dot = (name: string) => group.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
  expect(dot('green').disabled).toBe(true);
  expect(dot('green').title).toBe('Used by an overlapping highlight');
  expect(dot('blue').disabled).toBe(false);
  fireEvent.click(dot('green'));
  expect(props.onPick).not.toHaveBeenCalled();
});

it('Escape closes the colour picker first, then the menu, then the bar', () => {
  const props = setup();
  fireEvent.keyDown(screen.getByRole('button', { name: /Highlight/ }), { key: 'ArrowUp' });
  expect(screen.getByRole('group', { name: 'Highlight colour' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Highlight colour' })).toBeNull();
  expect(props.onDismiss).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(props.onDismiss).toHaveBeenCalledTimes(1);
});

it('Escape closes the menu first, then dismisses the toolbar', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(props.onDismiss).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(props.onDismiss).toHaveBeenCalled();
});

it('Tab from the selection moves focus into the toolbar', () => {
  setup();
  fireEvent.keyDown(window, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Highlight/ }));
});

it('flips below a selection near the top of the window', () => {
  setup({ pending: { ...pending, rect: { ...pending.rect, top: 20, bottom: 40 } as DOMRect } });
  expect(screen.getByRole('toolbar').getAttribute('data-flip')).toBe('true');
});

it('runs Listen from here and then dismisses the selection', () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: /Listen from here/ }));
  expect(props.onListen).toHaveBeenCalledTimes(1);
  expect(props.onDismiss).toHaveBeenCalled();
});

it('leaves Listen from here out when the article cannot be read aloud', () => {
  setup({ hidden: new Set(['listen']) });
  expect(screen.queryByRole('button', { name: /Listen from here/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Highlight/ })).toBeTruthy();
});
