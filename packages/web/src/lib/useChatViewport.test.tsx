import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatViewport } from './useChatViewport';

function Frame() {
  const frame = useRef<HTMLDivElement>(null);
  useChatViewport(frame);
  return (
    <div ref={frame}>
      <div className="silo-chat">
        <textarea aria-label="Chat" />
      </div>
      <input aria-label="Other" />
    </div>
  );
}

const originalViewport = window.visualViewport;
const originalMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalViewport });
  window.matchMedia = originalMatchMedia;
});

it('tracks the viewport through blur and non-chat focus, and clears it on keyboard close', async () => {
  const viewport = Object.assign(new EventTarget(), { height: 470, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  const view = render(<Frame />);
  const frame = view.container.firstElementChild as HTMLElement;
  const field = view.getByLabelText('Chat');
  act(() => field.focus());
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('470px');
  viewport.offsetTop = 24;
  act(() => viewport.dispatchEvent(new Event('scroll')));
  expect(frame.style.getPropertyValue('--silo-chat-viewport-top')).toBe('24px');
  fireEvent.change(field, { target: { value: 'Hello' } });
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('470px');
  viewport.height = window.innerHeight - 15;
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('');
  viewport.height = window.innerHeight;
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('');
  viewport.height = 470;
  act(() => viewport.dispatchEvent(new Event('resize')));
  await act(async () => view.getByLabelText('Other').focus());
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('470px');
  await act(async () => view.getByLabelText('Other').blur());
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('470px');
  act(() => field.focus());
  view.unmount();
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('');
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('');
});

it('leaves the layout alone for pinch zoom, desktop and missing viewport API', () => {
  const viewport = Object.assign(new EventTarget(), { height: 470, offsetTop: 0, scale: 2 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  const view = render(<Frame />);
  const frame = view.container.firstElementChild as HTMLElement;
  act(() => view.getByLabelText('Chat').focus());
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('');
  viewport.scale = 1;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(frame.style.getPropertyValue('--silo-chat-viewport-height')).toBe('');
  view.unmount();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: null });
  const withoutApi = render(<Frame />);
  act(() => withoutApi.getByLabelText('Chat').focus());
  expect((withoutApi.container.firstElementChild as HTMLElement).style.cssText).toBe('');
});
