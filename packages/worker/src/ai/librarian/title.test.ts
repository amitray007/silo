import { generateText } from 'ai';
import { afterEach, expect, it, vi } from 'vitest';
import { credential } from '../test-helpers.js';
import { generateChatTitle } from './title.js';

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: vi.fn(),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
const request = {
  chatId: 'chat',
  messages: [
    {
      id: 'user',
      role: 'user' as const,
      parts: [{ type: 'text', text: 'Explain this' }],
      metadata: { action: 'explain', quote: 'Quoted passage' },
    },
  ],
  link: { id: 'link', title: 'Article', url: 'https://example.com', site: 'Example' },
};
it('uses prompt and article context and sanitizes the result', async () => {
  vi.mocked(generateText).mockResolvedValue({ text: ' "A title\nfor the article" ' } as Awaited<
    ReturnType<typeof generateText>
  >);
  expect(await generateChatTitle(credential, 'model', request)).toBe('A title for the article');
  const options = vi.mocked(generateText).mock.calls[0]?.[0];
  expect(JSON.parse(String(options?.prompt))).toMatchObject({
    prompt: 'Explain this',
    article: { title: 'Article', url: 'https://example.com', site: 'Example' },
    action: 'explain',
    quote: 'Quoted passage',
  });
});
it('falls back on empty output, error, or timeout', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(generateText)
    .mockResolvedValueOnce({ text: '   ' } as Awaited<ReturnType<typeof generateText>>)
    .mockRejectedValueOnce(new Error('secret'));
  expect(await generateChatTitle(credential, 'model', request)).toBeNull();
  expect(await generateChatTitle(credential, 'model', request)).toBeNull();
  vi.useFakeTimers();
  vi.mocked(generateText).mockImplementationOnce(() => new Promise(() => {}));
  const pending = generateChatTitle(credential, 'model', request);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toBeNull();
  vi.restoreAllMocks();
});
