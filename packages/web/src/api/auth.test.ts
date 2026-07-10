import { describe, expect, it, vi } from 'vitest';
import { emitAuthCleared, onAuthCleared } from './auth';

describe('onAuthCleared', () => {
  it('fires subscribers when emitAuthCleared is called (the signal apiFetch fires on a 401)', () => {
    const cb = vi.fn();
    onAuthCleared(cb);

    emitAuthCleared();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops future notifications', () => {
    const cb = vi.fn();
    const unsubscribe = onAuthCleared(cb);
    unsubscribe();

    emitAuthCleared();

    expect(cb).not.toHaveBeenCalled();
  });

  it('supports multiple independent subscribers', () => {
    const first = vi.fn();
    const second = vi.fn();
    onAuthCleared(first);
    onAuthCleared(second);

    emitAuthCleared();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
