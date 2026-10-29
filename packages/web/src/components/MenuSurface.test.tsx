import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MenuAction, MenuSurface } from './MenuSurface';

it.each([false, true])('returns focus to the trigger on Tab (shift: %s)', (shiftKey) => {
  const close = vi.fn();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const view = render(
    <MenuSurface onClose={close}>
      <MenuAction icon={null}>First action</MenuAction>
    </MenuSurface>,
  );
  const item = screen.getByRole('menuitem');
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(item, event);
  expect(close).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(trigger);
  view.unmount();
  trigger.remove();
});
