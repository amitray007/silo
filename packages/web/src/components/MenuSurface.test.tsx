import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MenuAction, MenuSurface } from './MenuSurface';

it('closes a desktop menu on Tab without cancelling normal tab navigation', () => {
  const close = vi.fn();
  render(
    <MenuSurface onClose={close}>
      <MenuAction icon={null}>First action</MenuAction>
    </MenuSurface>,
  );
  const item = screen.getByRole('menuitem');
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  fireEvent(item, event);
  expect(close).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(false);
});
