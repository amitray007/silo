import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { readerTypeDefaults } from '../../../lib/readerPrefs';
import { ReaderPrefsProvider, useReaderPrefs } from '../../../lib/useReaderPrefs';
import { makeLink } from '../../../test/fixtures';
import { TypeSheet } from './TypeSheet';

function Readout() {
  const {
    prefs: { type, width },
  } = useReaderPrefs();
  return <output data-testid="state">{`${JSON.stringify(type)}|${width}`}</output>;
}

function state() {
  const [type, width] = (screen.getByTestId('state').textContent ?? '').split('|');
  return { type: JSON.parse(type ?? '{}'), width };
}

let nextId = 0;
function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReaderPrefsProvider link={makeLink({ id: `type-${nextId++}`, feedId: 'feed' })}>
        <TypeSheet />
        <Readout />
      </ReaderPrefsProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
});

it('shows the five rows with the defaults selected and no helper text', () => {
  const { container } = open();
  for (const name of ['Font', 'Line height', 'Width', 'Theme']) {
    expect(screen.getByRole('radiogroup', { name })).toBeDefined();
  }
  expect(screen.getByRole('spinbutton', { name: 'Size' }).getAttribute('aria-valuenow')).toBe('16');
  for (const name of ['Inter', 'Normal', 'Medium', 'Default']) {
    expect(screen.getByRole('radio', { name }).getAttribute('aria-checked')).toBe('true');
  }
  expect(screen.getAllByRole('radio')).toHaveLength(11);
  expect(container.querySelector('p')).toBeNull();
  expect(container.querySelector('select')).toBeNull();
});

it('applies each control to this article', () => {
  open();
  fireEvent.click(screen.getByRole('radio', { name: 'Literata' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Relaxed' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Wide' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Sepia' }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase size' }));
  expect(state()).toEqual({
    type: { font: 'serif', size: 17, leading: 'relaxed', theme: 'sepia' },
    width: 'wide',
  });
  fireEvent.click(screen.getByRole('radio', { name: 'Mono' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Compact' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Narrow' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Default' }));
  fireEvent.click(screen.getByRole('button', { name: 'Decrease size' }));
  expect(state()).toEqual({
    type: { ...readerTypeDefaults, font: 'mono', leading: 'compact' },
    width: 'narrow',
  });
});

it('stops the stepper at 14 and 24 and disables the button at each bound', () => {
  open();
  const smaller = screen.getByRole('button', { name: 'Decrease size' }) as HTMLButtonElement;
  const larger = screen.getByRole('button', { name: 'Increase size' }) as HTMLButtonElement;
  for (let step = 0; step < 4; step += 1) fireEvent.click(smaller);
  expect(state().type.size).toBe(14);
  expect(smaller.disabled).toBe(true);
  expect(larger.disabled).toBe(false);
  fireEvent.click(smaller);
  expect(state().type.size).toBe(14);
  const spin = screen.getByRole('spinbutton', { name: 'Size' });
  fireEvent.keyDown(spin, { key: 'End' });
  expect(state().type.size).toBe(24);
  expect(larger.disabled).toBe(true);
  expect(spin.getAttribute('aria-valuemin')).toBe('14');
  expect(spin.getAttribute('aria-valuemax')).toBe('24');
  expect(spin.getAttribute('aria-valuetext')).toBe('24 pixels');
});

it('steps the size with arrow keys and Home', () => {
  open();
  const spin = screen.getByRole('spinbutton', { name: 'Size' });
  fireEvent.keyDown(spin, { key: 'ArrowUp' });
  fireEvent.keyDown(spin, { key: 'ArrowUp' });
  expect(state().type.size).toBe(18);
  fireEvent.keyDown(spin, { key: 'ArrowDown' });
  expect(state().type.size).toBe(17);
  fireEvent.keyDown(spin, { key: 'Home' });
  expect(state().type.size).toBe(14);
  fireEvent.keyDown(spin, { key: 'ArrowDown' });
  expect(state().type.size).toBe(14);
});

it('moves and selects with arrow keys, wraps, and keeps one tab stop per group', () => {
  open();
  const inter = screen.getByRole('radio', { name: 'Inter' });
  expect(inter.tabIndex).toBe(0);
  expect(screen.getByRole('radio', { name: 'Literata' }).tabIndex).toBe(-1);
  inter.focus();
  fireEvent.keyDown(inter, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Literata' }));
  expect(state().type.font).toBe('serif');
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
  expect(state().type.font).toBe('mono');
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Inter' }));
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Mono' }));
  expect(state().type.font).toBe('mono');
});

it('lets every label and option wrap instead of truncating', () => {
  const { container } = open();
  expect(container.querySelector('[style*="ellipsis"], [style*="overflow"]')).toBeNull();
  for (const option of screen.getAllByRole('radio')) {
    expect(option.textContent?.trim().length).toBeGreaterThan(0);
  }
});

it('wraps from the first option to the last with ArrowUp', () => {
  open();
  const inter = screen.getByRole('radio', { name: 'Inter' });
  inter.focus();
  fireEvent.keyDown(inter, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Mono' }));
  expect(state().type.font).toBe('mono');
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
  expect(state().type.font).toBe('serif');
});
