import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ failures: 0 }));
vi.mock('shiki/core', async (original) => {
  const actual = await original<typeof import('shiki/core')>();
  return {
    ...actual,
    createHighlighterCore: (...args: Parameters<typeof actual.createHighlighterCore>) => {
      if (state.failures-- > 0) return Promise.reject(new Error('Failed to fetch chunk'));
      return actual.createHighlighterCore(...args);
    },
  };
});
afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});
it('retries initialization after a failed chunk load and highlights the next block', async () => {
  state.failures = 1;
  const { highlightCode } = await import('./highlightCode');
  const code = document.createElement('code');
  code.dataset.lang = 'js';
  code.textContent = 'const answer = 42;';
  await expect(highlightCode(code, () => true)).rejects.toThrow('Failed to fetch chunk');
  expect(code.textContent).toBe('const answer = 42;');
  expect(code.dataset.highlighted).toBeUndefined();
  await highlightCode(code, () => true);
  expect(code.dataset.highlighted).toBe('true');
  expect(code.querySelector('span')).not.toBeNull();
  expect(code.textContent).toBe('const answer = 42;');
});
