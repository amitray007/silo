import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Composer, ComposerBar, type QuickAction } from './Composer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const quick: readonly QuickAction[] = [
  ['explain', 'Explain'],
  ['simplify', 'Simplify'],
];

function composer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  return (
    <Composer
      value=""
      onChange={() => {}}
      onSend={() => {}}
      label="Ask"
      placeholder="Ask…"
      quick={quick}
      {...props}
    />
  );
}

it('renders the chips in order, above the field', () => {
  const { container } = render(composer());
  const chips = container.querySelector('.silo-composer-chips') as HTMLElement;
  const field = container.querySelector('.silo-composer-field') as HTMLElement;
  expect(Array.from(chips.querySelectorAll('button'), (b) => b.textContent)).toEqual([
    'Explain',
    'Simplify',
  ]);
  expect(chips.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('sends the quick action id and label on click', () => {
  const onQuick = vi.fn();
  render(composer({ onQuick }));
  fireEvent.click(screen.getByRole('button', { name: 'Simplify' }));
  expect(onQuick).toHaveBeenCalledWith('simplify', 'Simplify');
});

it('disables the chips when quickDisabled', () => {
  const onQuick = vi.fn();
  render(composer({ onQuick, quickDisabled: true }));
  const chip = screen.getByRole('button', { name: 'Explain' }) as HTMLButtonElement;
  expect(chip.disabled).toBe(true);
  fireEvent.click(chip);
  expect(onQuick).not.toHaveBeenCalled();
});

it('shows no chip row without quick actions', () => {
  const { container } = render(composer({ quick: [] }));
  expect(container.querySelector('.silo-composer-chips')).toBeNull();
});

it('does not reserve space for an empty suggestions result', () => {
  const { container } = render(
    composer({ quick: [], suggestions: { status: 'ready', items: [] } }),
  );
  expect(container.querySelector('.silo-composer-chips')).toBeNull();
});

it('swaps Send for Stop while busy', () => {
  const onStop = vi.fn();
  const { rerender } = render(composer({ value: 'hi' }));
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
  rerender(composer({ value: 'hi', busy: true, onStop }));
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(onStop).toHaveBeenCalled();
});

it('still renders the passage and the lead slot', () => {
  const onRemove = vi.fn();
  const { container } = render(
    composer({
      passage: { quote: 'A passage', onRemove },
      lead: <button type="button">Lead</button>,
    }),
  );
  expect(container.querySelector('.silo-chat-passage')?.textContent).toBe('A passage');
  fireEvent.click(screen.getByRole('button', { name: 'Remove passage' }));
  expect(onRemove).toHaveBeenCalled();
  const field = container.querySelector('.silo-composer-field');
  expect(field?.contains(screen.getByText('Lead'))).toBe(true);
});

it('appends follow-ups after quick actions and sends their text', () => {
  const onSuggestion = vi.fn();
  const { container } = render(
    composer({
      suggestions: { status: 'ready', items: [{ kind: 'do', text: 'Tag these' }] },
      onSuggestion,
    }),
  );
  expect(
    Array.from(container.querySelectorAll('.silo-composer-chips button'), (b) => b.textContent),
  ).toEqual(['Explain', 'Simplify', 'Tag these']);
  fireEvent.click(screen.getByRole('button', { name: 'Tag these' }));
  expect(onSuggestion).toHaveBeenCalledWith('Tag these');
});

it('shows three static pending follow-up chips', () => {
  render(composer({ suggestions: { status: 'pending' } }));
  expect(screen.getAllByRole('button', { name: 'Loading follow-up' })).toHaveLength(3);
});

it('puts the bar hint inside the bar, announced, and drops it when cleared', () => {
  const props = {
    value: '',
    onChange: () => {},
    onSend: () => {},
    label: 'Ask',
    placeholder: 'Ask…',
  };
  const { container, rerender } = render(<ComposerBar {...props} hint="Allow or deny first." />);
  const bar = container.querySelector('.silo-chat-bar') as HTMLElement;
  const hint = screen.getByRole('status');
  expect(hint.textContent).toBe('Allow or deny first.');
  expect(bar.contains(hint)).toBe(true);
  rerender(<ComposerBar {...props} />);
  expect(screen.queryByRole('status')).toBeNull();
});

it.each([false, true])('Enter uses the primary pointer: coarse=%s', (coarse) => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: coarse }));
  const onSend = vi.fn();
  render(composer({ value: 'A question', onSend }));
  const field = screen.getByRole('textbox', { name: 'Ask' });
  expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(coarse);
  expect(onSend).toHaveBeenCalledTimes(coarse ? 0 : 1);
  onSend.mockClear();
  expect(fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })).toBe(true);
  expect(fireEvent.keyDown(field, { key: 'Enter', isComposing: true })).toBe(true);
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSend).toHaveBeenCalledTimes(1);
});
