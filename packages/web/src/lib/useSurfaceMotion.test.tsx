import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSurfaceMotion } from './useSurfaceMotion';

function Probe({ phase = 'bar', text = 'Ask' }: { phase?: string; text?: string }) {
  const motion = useSurfaceMotion(phase, 'bottom');
  return (
    <div ref={motion.root} data-testid="surface" data-phase={phase}>
      <div ref={motion.shell}>
        <div key={phase}>
          <button type="button" onClick={motion.begin}>
            {text}
          </button>
        </div>
      </div>
    </div>
  );
}

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
beforeEach(() =>
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn() }),
);
afterEach(() => {
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

it('morphs explicit phase changes with a transform and leaves streamed growth in natural flow', () => {
  const motions: Array<{ frames: Keyframe[]; animation: Animation }> = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const bar = this.closest('[data-testid=surface]')?.getAttribute('data-phase') === 'bar';
    return new DOMRect(10, 20, bar ? 200 : 400, bar ? 40 : 140);
  });
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation((frames) => {
    const animation = { cancel: vi.fn(), onfinish: null } as unknown as Animation;
    motions.push({ frames: frames as Keyframe[], animation });
    return animation;
  });
  const view = render(<Probe />);
  fireEvent.click(screen.getByRole('button'));
  view.rerender(<Probe phase="composer" text="Ask a question" />);
  expect(motions.some(({ frames }) => frames.every((frame) => 'transform' in frame))).toBe(true);
  expect(
    motions.every(({ frames }) =>
      frames.every((frame) => !('width' in frame) && !('height' in frame)),
    ),
  ).toBe(true);
  const count = motions.length;
  view.rerender(<Probe phase="composer" text="A longer streamed answer" />);
  expect(motions).toHaveLength(count);
  expect(screen.getByRole('button').style.position).toBe('');
  view.unmount();
  expect(motions.at(-1)?.animation.cancel).toHaveBeenCalled();
});

it('removes the leaving content when the phase morph ends', () => {
  let finish: (() => void) | undefined;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 200,
    bottom: 100,
    width: 200,
    height: 100,
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(
    () =>
      ({
        cancel: vi.fn(),
        set onfinish(callback: () => void) {
          finish = callback;
        },
      }) as unknown as Animation,
  );
  const view = render(<Probe />);
  fireEvent.click(screen.getByRole('button'));
  view.rerender(<Probe phase="composer" text="Question" />);
  expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  act(() => finish?.());
  expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
});

it('skips the morph when reduced motion is requested', () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const view = render(<Probe />);
  fireEvent.click(screen.getByRole('button'));
  view.rerender(<Probe phase="composer" text="Question" />);
  expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
});
