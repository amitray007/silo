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
    parts: [{ type: 'text', text: i < 6 ? 'old '.repeat(200) : `recent ${i}` }],
  }),
);
const request = {
  chatId: 'chat',
  messages,
  link: null,
  messageSeqs: messages.map((_, i) => (i + 1) * 2),
};
const smallWindow = { ...credential, model: { ...credential.model, contextWindow: 2000 } };
it('compacts once, persists the stored cutoff and reuses summary on the next run', async () => {
  const generate = vi.fn(async () => okResult('Owner prefers books'));
  const model = new MockLanguageModelV4({ doGenerate: generate });
  const first = await compactConversation(request, messages, smallWindow, model, 'persona');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(saveChatSummary).toHaveBeenCalledExactlyOnceWith('chat', 'Owner prefers books', 8);
  expect(first.messages).toHaveLength(8);
  const second = await compactConversation(
    {
      ...request,
      summary: 'Owner prefers books',
      summarizedCount: 4,
    },
    messages,
    smallWindow,
    model,
    'persona',
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(second.instructions).toContain('Earlier conversation (summary):\nOwner prefers books');

  expect(JSON.stringify(second.messages)).toContain('recent 6');
  const reply = new MockLanguageModelV4({ doGenerate: async () => okResult('Answer') });
  await generateText({ model: reply, ...second });
  const received = JSON.stringify(reply.doGenerateCalls[0]?.prompt);
  expect(received).toContain('Earlier conversation (summary)');
  expect(received).toContain('Owner prefers books');
  expect(received).toContain('recent 6');
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
    ).toBeLessThanOrEqual(1200);
    expect(result.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'recent 11' }]);
    const reply = new MockLanguageModelV4({ doGenerate: async () => okResult('Still answers') });
    expect((await generateText({ model: reply, ...result })).text).toBe('Still answers');
    expect(warn).toHaveBeenCalledWith('silo ai: librarian-compaction@v1 failed (provider_error)');
    warn.mockRestore();
  },
);
it('moves the cutoff back so the kept history starts with a user turn', async () => {
  const odd = [
    ...messages,
    { id: '12', role: 'user' as const, parts: [{ type: 'text' as const, text: 'recent 12' }] },
  ];
  const generate = vi.fn(async () => okResult('summary'));
  const model = new MockLanguageModelV4({ doGenerate: generate });
  const result = await compactConversation(
    { ...request, messages: odd, messageSeqs: odd.map((_, i) => (i + 1) * 2) },
    odd,
    smallWindow,
    model,
    'persona',
  );
  expect(saveChatSummary).toHaveBeenCalledExactlyOnceWith('chat', 'summary', 8);
  expect(result.messages[0]?.role).toBe('user');
});

it('sends an oversized newest user turn intact', async () => {
  const newest: UIMessage[] = [
    ...messages.slice(6),
    { id: 'huge', role: 'user', parts: [{ type: 'text', text: 'new '.repeat(3000) }] },
  ];
  const result = await compactConversation(
    request,
    newest,
    smallWindow,
    new MockLanguageModelV4({ doGenerate: async () => okResult('summary') }),
    'persona',
  );
  const reply = new MockLanguageModelV4({ doGenerate: async () => okResult('answer') });
  await generateText({ model: reply, ...result });
  expect(JSON.stringify(reply.doGenerateCalls[0]?.prompt)).toContain('new '.repeat(3000));
});

it('keeps the approval call and response when trimming older turns', async () => {
  const newest: UIMessage[] = [
    ...messages.slice(6),
    { id: 'u', role: 'user', parts: [{ type: 'text', text: 'approve '.repeat(2000) }] },
    {
      id: 'a',
      role: 'assistant',
      parts: [
        {
          type: 'tool-trash_link',
          toolCallId: 'call1',
          state: 'approval-responded',
          input: { id: 'link1' },
          approval: { id: 'approval1', approved: true },
        },
      ],
    },
  ];
  const result = await compactConversation(
    request,
    newest,
    smallWindow,
    new MockLanguageModelV4({ doGenerate: async () => okResult('summary') }),
    'persona',
  );
  expect(result.messages[0]?.role).toBe('user');
  const sent = JSON.stringify(result.messages);
  expect(sent).toContain('tool-call');
  expect(sent).toContain('tool-approval-response');
  expect(sent).toContain('approval1');
  expect(sent).not.toContain('recent 6');
});

it('summarizes a large history in bounded steps across two turns', async () => {
  const history = messages.map((message, i) => ({
    ...message,
    parts: [{ type: 'text' as const, text: i < 6 ? 'old '.repeat(450) : 'recent' }],
  }));
  const model = new MockLanguageModelV4({ doGenerate: async () => okResult('summary') });
  await compactConversation(request, history, smallWindow, model, 'persona');
  expect(saveChatSummary).toHaveBeenLastCalledWith('chat', 'summary', 4);
  await compactConversation(
    { ...request, summary: 'summary', summarizedCount: 2 },
    history,
    smallWindow,
    model,
    'persona',
  );
  expect(saveChatSummary).toHaveBeenLastCalledWith('chat', 'summary', 8);
  expect(model.doGenerateCalls).toHaveLength(2);
  for (const call of model.doGenerateCalls) {
    const chars = call.prompt
      .map((message) =>
        message.role === 'system' ? message.content.length : JSON.stringify(message.content).length,
      )
      .reduce((a, b) => a + b, 0);
    expect(chars / 4).toBeLessThanOrEqual(1200);
  }
});
