import { saveChatSummary } from '@silo/core/ai-credential';
import { generateText, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, expect, it, vi } from 'vitest';
import { credential, okResult } from '../test-helpers.js';
import { compactConversation } from './compaction.js';

vi.mock('@silo/core/ai-credential', () => ({ saveChatSummary: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const messages: (UIMessage & { role: 'user' | 'assistant' })[] = Array.from(
  { length: 12 },
  (_, i) => ({
    id: String(i),
    role: i % 2 ? 'assistant' : 'user',
    parts: [{ type: 'text', text: i < 6 ? 'old '.repeat(2000) : `recent ${i}` }],
  }),
);
const request = {
  chatId: 'chat',
  messages,
  link: null,
  messageSeqs: messages.map((_, i) => (i + 1) * 2),
};
const smallWindow = { ...credential, model: { ...credential.model, contextWindow: 3000 } };
it('compacts once, persists the stored cutoff and reuses summary on the next run', async () => {
  const generate = vi.fn(async () => okResult('Owner prefers books'));
  const model = new MockLanguageModelV4({ doGenerate: generate });
  const first = await compactConversation(request, messages, smallWindow, model, 'persona');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(saveChatSummary).toHaveBeenCalledExactlyOnceWith('chat', 'Owner prefers books', 12);
  expect(first.messages).toHaveLength(6);
  const second = await compactConversation(
    {
      ...request,
      summary: 'Owner prefers books',
      summarizedCount: 6,
    },
    messages,
    smallWindow,
    model,
    'persona',
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(second.instructions).toContain('Earlier conversation (summary):\nOwner prefers books');
  expect(JSON.stringify(second.messages)).not.toContain('old old');
  expect(JSON.stringify(second.messages)).toContain('recent 6');
  const reply = new MockLanguageModelV4({ doGenerate: async () => okResult('Answer') });
  await generateText({ model: reply, ...second });
  const received = JSON.stringify(reply.doGenerateCalls[0]?.prompt);
  expect(received).toContain('Earlier conversation (summary)');
  expect(received).toContain('Owner prefers books');
  expect(received).toContain('recent 6');
  expect(received).not.toContain('old old');
});
it('does not compact short chats', async () => {
  const generate = vi.fn(async () => okResult('summary'));
  const result = await compactConversation(
    request,
    messages.slice(6),
    credential,
    new MockLanguageModelV4({ doGenerate: generate }),
    'persona',
  );
  expect(generate).not.toHaveBeenCalled();
  expect(result.messages).toHaveLength(6);
});
it.each(['generation', 'persistence'])(
  'trims and keeps answering on %s failure',
  async (failure) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (failure === 'persistence')
      vi.mocked(saveChatSummary).mockRejectedValueOnce(new Error('secret'));
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (failure === 'generation') throw new Error('secret');
        return okResult('summary');
      },
    });
    const result = await compactConversation(request, messages, smallWindow, model, 'persona');
    expect(result.messages.length).toBeGreaterThan(0);
    expect(
      (result.instructions.length + JSON.stringify(result.messages).length) / 4,
    ).toBeLessThanOrEqual(1800);
    expect(result.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'recent 11' }]);
    const reply = new MockLanguageModelV4({ doGenerate: async () => okResult('Still answers') });
    expect((await generateText({ model: reply, ...result })).text).toBe('Still answers');
    expect(warn).toHaveBeenCalledWith('silo ai: librarian-compaction@v1 failed (provider_error)');
    warn.mockRestore();
  },
);
