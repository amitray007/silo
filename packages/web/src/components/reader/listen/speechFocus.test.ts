import { expect, it, vi } from 'vitest';
import { takeSpeech } from './speechFocus';

it('stops the previous holder when another claims the speakers', () => {
  const first = vi.fn();
  const second = vi.fn();
  takeSpeech(first);
  takeSpeech(second);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
});

it('lets a holder that released leave the next claim alone', () => {
  const first = vi.fn();
  takeSpeech(first)();
  takeSpeech(vi.fn());
  expect(first).not.toHaveBeenCalled();
});
