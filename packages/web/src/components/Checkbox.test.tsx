import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

afterEach(cleanup);

it('toggles through its label and retains native form semantics', () => {
  const change = vi.fn();
  render(<Checkbox label="Sync recents" name="recents" defaultChecked onChange={change} />);
  const checkbox = screen.getByRole('checkbox', { name: 'Sync recents' }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  expect(checkbox.name).toBe('recents');
  fireEvent.click(screen.getByText('Sync recents'));
  expect(checkbox.checked).toBe(false);
  expect(change).toHaveBeenCalledOnce();
});

it('does not toggle a disabled checkbox through its label', () => {
  const change = vi.fn();
  render(<Checkbox label="Sync recents" disabled onChange={change} />);
  fireEvent.click(screen.getByText('Sync recents'));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(change).not.toHaveBeenCalled();
});
