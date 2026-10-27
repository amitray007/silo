import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReaderWidth } from './useReaderWidth';

function Preference() {
  const [width, setWidth] = useReaderWidth();
  return (
    <button type="button" onClick={() => setWidth('wide')}>
      {width}
    </button>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  const reset = renderHook(useReaderWidth);
  act(() => reset.result.current[1]('medium'));
  reset.unmount();
  localStorage.removeItem('silo.readerWidth');
});

it('defaults to Medium, including unknown stored values', () => {
  const view = render(<Preference />);
  expect(screen.getByText('medium')).toBeDefined();
  localStorage.setItem('silo.readerWidth', 'invalid');
  view.rerender(<Preference />);
  expect(screen.getByText('medium')).toBeDefined();
});

it('persists selection, updates all subscribers, and survives remounting', () => {
  const view = render(
    <>
      <Preference />
      <Preference />
    </>,
  );
  fireEvent.click(screen.getAllByText('medium')[0] as HTMLElement);
  expect(screen.getAllByText('wide')).toHaveLength(2);
  expect(localStorage.getItem('silo.readerWidth')).toBe('wide');
  view.unmount();
  render(<Preference />);
  expect(screen.getByText('wide')).toBeDefined();
});

it('updates when another tab changes storage', () => {
  render(<Preference />);
  act(() => {
    localStorage.setItem('silo.readerWidth', 'narrow');
    window.dispatchEvent(new StorageEvent('storage', { key: 'silo.readerWidth' }));
  });
  expect(screen.getByText('narrow')).toBeDefined();
});

it('keeps selection usable when storage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const view = render(<Preference />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('wide')).toBeDefined();
  view.unmount();
  render(<Preference />);
  expect(screen.getByText('wide')).toBeDefined();
});

it('applies selection when writes fail but stored values remain readable', () => {
  localStorage.setItem('silo.readerWidth', 'narrow');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  const view = render(<Preference />);
  expect(screen.getByText('narrow')).toBeDefined();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('wide')).toBeDefined();
  view.unmount();
  vi.restoreAllMocks();
  // A successful selection leaves memory-only mode for later mounts.
  render(<Preference />);
  fireEvent.click(screen.getByRole('button'));
  expect(localStorage.getItem('silo.readerWidth')).toBe('wide');
});
