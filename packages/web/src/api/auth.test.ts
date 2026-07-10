import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, emitAuthCleared, getToken, onAuthCleared, setToken } from './auth';

describe('token storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearToken();
  });

  it('round-trips a token through sessionStorage via setToken/getToken', () => {
    setToken('secret-token');

    expect(getToken()).toBe('secret-token');
    expect(sessionStorage.getItem('silo.apiToken')).toBe('secret-token');
  });

  it('returns null when no token has ever been set', () => {
    expect(getToken()).toBeNull();
  });

  it('clearToken removes the token from memory and sessionStorage', () => {
    setToken('secret-token');
    clearToken();

    expect(getToken()).toBeNull();
    expect(sessionStorage.getItem('silo.apiToken')).toBeNull();
  });

  it('reads a token already present in sessionStorage on first access (in-memory cache primed lazily)', async () => {
    sessionStorage.setItem('silo.apiToken', 'pre-existing-token');

    // The in-memory cache is module-level state, already primed to `null` by
    // this suite's earlier calls to clearToken() — resetModules + a fresh
    // dynamic import gets a truly unprimed module, so this exercises the
    // real "first access of the page load" read-through path rather than
    // one already warmed by a prior test/beforeEach.
    vi.resetModules();
    const fresh = await import('./auth');

    expect(fresh.getToken()).toBe('pre-existing-token');
  });

  it('serves subsequent reads from the in-memory cache without re-touching sessionStorage', () => {
    setToken('secret-token');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    expect(getToken()).toBe('secret-token');
    expect(getItemSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
  });

  it('falls back to memory-only when sessionStorage.setItem throws (private mode / disabled storage)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => setToken('secret-token')).not.toThrow();
    expect(getToken()).toBe('secret-token');

    setItemSpy.mockRestore();
  });

  it('falls back to memory-only when sessionStorage.getItem throws', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => getToken()).not.toThrow();
    expect(getToken()).toBeNull();

    getItemSpy.mockRestore();
  });

  it('clearToken does not throw when sessionStorage.removeItem throws', () => {
    setToken('secret-token');
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => clearToken()).not.toThrow();
    expect(getToken()).toBeNull();

    removeItemSpy.mockRestore();
  });
});

describe('onAuthCleared', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearToken();
  });

  it('does not fire from clearToken() alone — only emitAuthCleared() (called by apiFetch on 401) fires it', () => {
    const cb = vi.fn();
    onAuthCleared(cb);

    clearToken();

    expect(cb).not.toHaveBeenCalled();
  });

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
