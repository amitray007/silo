import { generateText } from 'ai';
import { afterEach, expect, it, vi } from 'vitest';
import { credential } from '../test-helpers.js';
import { suggestFollowups } from './suggestions.js';

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

it('drops invalid items, clamps length, and limits suggestions to three', async () => {
  vi.mocked(generateText).mockResolvedValue({
    output: {
      items: [
        { kind: 'bad', text: 'bad' },
        { kind: 'ask', text: 'x'.repeat(80) },
        { kind: 'do', text: 'Tag these' },
        { kind: 'ask', text: 'Why?' },
        { kind: 'ask', text: 'More?' },
      ],
    },
  } as unknown as Awaited<ReturnType<typeof generateText>>);
  const items = await suggestFollowups(credential, 'test-model', 'Question', 'Answer');
  expect(items).toEqual([
    { kind: 'ask', text: 'x'.repeat(48) },
    { kind: 'do', text: 'Tag these' },
    { kind: 'ask', text: 'Why?' },
  ]);
});

it('reports a failure as null, not an empty list, and logs only a fixed code', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(generateText).mockRejectedValue(new Error('SECRET_PROVIDER_TEXT'));
  expect(await suggestFollowups(credential, 'test-model', 'Question', 'Answer')).toBeNull();
  expect(warn).toHaveBeenCalledWith('silo ai: librarian@v1 failed (provider_error)');
  warn.mockRestore();
});
