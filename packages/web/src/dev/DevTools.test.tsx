import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DevTools } from './DevTools';

let phone = false;
vi.mock('../lib/breakpoints', () => ({
  layoutMedia: { phone: 'phone' },
  useMediaQuery: () => phone,
}));
vi.mock('agentation', () => ({
  Agentation: function MockAgentation() {
    useLayoutEffect(() => {
      const host = document.createElement('agentation-toolbar');
      const root = host.attachShadow({ mode: 'open' });
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Start feedback mode');
      button.onclick = () => button.setAttribute('aria-label', 'Exit');
      root.append(button);
      document.body.append(host);
      return () => host.remove();
    }, []);
    return null;
  },
}));
beforeEach(() => {
  phone = false;
});
afterEach(() => {
  document.querySelector('agentation-toolbar')?.remove();
});

it('keeps the heavy feedback tool unmounted until requested and releases it after exit', async () => {
  render(<DevTools />);
  expect(document.querySelector('agentation-toolbar')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Start feedback mode' }));
  await waitFor(() =>
    expect(
      document
        .querySelector('agentation-toolbar')
        ?.shadowRoot?.querySelector('[aria-label="Exit"]'),
    ).toBeTruthy(),
  );
  act(() => {
    document
      .querySelector('agentation-toolbar')!
      .shadowRoot!.querySelector('button')!
      .setAttribute('aria-label', 'Start feedback mode');
  });
  await waitFor(() => expect(document.querySelector('agentation-toolbar')).toBeNull());
  expect(screen.getByRole('button', { name: 'Start feedback mode' })).toBeDefined();
});

it('retains the keyboard shortcut and phone annotation event', async () => {
  phone = true;
  const view = render(<DevTools />);
  expect(screen.queryByRole('button')).toBeNull();
  fireEvent.keyDown(window, { key: 'F', shiftKey: true, metaKey: true });
  await waitFor(() => expect(document.querySelector('agentation-toolbar')).not.toBeNull());
  view.unmount();
  render(<DevTools />);
  act(() => window.dispatchEvent(new Event('silo:annotate')));
  await waitFor(() => expect(document.querySelector('agentation-toolbar')).not.toBeNull());
});
