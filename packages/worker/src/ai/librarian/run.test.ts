import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credential } from '../test-helpers.js';

vi.mock('@silo/core', () => ({
  saveChatMessages: vi.fn(),
  getSetting: vi.fn(() => false),
  librarianPersona: 'Librarian persona',
  promptVersion: 1,
  librarianMessageSchema: { parse: (m: unknown) => m },
}));
vi.mock('@silo/core/ai-credential', () => ({
  resolveAiFeatureCredential: vi.fn(),
  getLibrarianToolSource: vi.fn(),
  librarianApprovalSecret: vi.fn(() => new Uint8Array(32)),
}));
vi.mock('../model.js', () => ({ languageModelFor: vi.fn() }));

vi.mock('./suggestions.js', () => ({
  suggestFollowups: vi.fn(async () => [{ kind: 'ask', text: 'What next?' }]),
}));

import { getSetting, saveChatMessages } from '@silo/core';
import { getLibrarianToolSource, resolveAiFeatureCredential } from '@silo/core/ai-credential';
import { languageModelFor } from '../model.js';
import { runLibrarian } from './run.js';
import { suggestFollowups } from './suggestions.js';

afterEach(() => vi.clearAllMocks());
describe('Librarian streaming', () => {
  it.each([
    [false, false, false],
    [false, true, false],
    [false, true, true],
    [true, true, false],
  ])(
    'streams text and persists suggestions only when enabled (transient=%s enabled=%s)',
    async (transient, enabled, empty) => {
      const items = empty ? [] : [{ kind: 'ask' as const, text: 'What next?' }];
      vi.mocked(suggestFollowups).mockResolvedValue(items);
      vi.mocked(getSetting).mockResolvedValue(enabled);
      vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
      vi.mocked(languageModelFor).mockReturnValue(
        new MockLanguageModelV4({
          doStream: async () => ({
            stream: new ReadableStream({
              start(c) {
                c.enqueue({ type: 'text-start', id: 't' });
                c.enqueue({ type: 'text-delta', id: 't', delta: 'Hello' });
                c.enqueue({ type: 'text-end', id: 't' });
                c.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: undefined },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: { total: 1, text: 1, reasoning: undefined },
                  },
                });
                c.close();
              },
            }),
          }),
        }),
      );
      const endRun = vi.fn();
      const response = await runLibrarian({
        endRun,
        transient,
        chatId: 'chat',
        messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        link: null,
      });
      const body = await response.text();
      expect(body).toContain('Hello');
      if (enabled && !transient) {
        expect(body).toContain('data-suggestions');
        expect(body).toContain('pending');
        expect(body).not.toContain('errorText');
        if (empty) expect(body).toContain('"items":[]');
        else expect(body).toContain('What next?');
        expect(saveChatMessages).toHaveBeenCalledWith(
          'chat',
          expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              parts: expect.arrayContaining([
                expect.objectContaining({
                  type: 'data-suggestions',
                  data: { status: 'ready', items },
                }),
              ]),
            }),
          ]),
        );
      } else expect(suggestFollowups).not.toHaveBeenCalled();
      expect(endRun).toHaveBeenCalled();
      if (transient) {
        expect(saveChatMessages).not.toHaveBeenCalled();
        return;
      }
      expect(saveChatMessages).toHaveBeenCalledWith(
        'chat',
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            parts: expect.arrayContaining([expect.objectContaining({ text: 'Hello' })]),
          }),
        ]),
      );
    },
  );
  it('streams reasoning with its total time and splits text into words', async () => {
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    vi.mocked(languageModelFor).mockReturnValue(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'reasoning-start', id: 'r' });
              c.enqueue({ type: 'reasoning-delta', id: 'r', delta: 'Weighing it.' });
              c.enqueue({ type: 'reasoning-end', id: 'r' });
              c.enqueue({ type: 'text-start', id: 't' });
              c.enqueue({ type: 'text-delta', id: 't', delta: 'alpha beta gamma ' });
              c.enqueue({ type: 'text-end', id: 't' });
              c.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: undefined },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: 1 },
                },
              });
              c.close();
            },
          }),
        }),
      }),
    );
    const response = await runLibrarian({
      chatId: 'chat',
      transient: false,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      link: null,
    });
    const body = await response.text();
    expect(body).toContain('"type":"reasoning-delta"');
    const thoughts = [...body.matchAll(/"type":"reasoning-delta","id":"[^"]+","delta":"([^"]*)"/g)];
    expect(thoughts.map((match) => match[1]).join('')).toBe('Weighing it.');
    expect(body).toMatch(/"messageMetadata":\{"reasoningMs":\d+\}/);
    const deltas = [...body.matchAll(/"type":"text-delta","id":"[^"]+","delta":"([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(deltas).toEqual(['alpha', ' ', 'beta', ' ', 'gamma', ' ']);
    const saved = vi.mocked(saveChatMessages).mock.calls[0]?.[1] as
      | { role: string; metadata?: { reasoningMs?: number } }[]
      | undefined;
    expect(saved?.find((message) => message.role === 'assistant')?.metadata?.reasoningMs).toEqual(
      expect.any(Number),
    );
  });
  it('frames imported quick answers as user input', async () => {
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    vi.mocked(getLibrarianToolSource).mockReturnValue(undefined);
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const response = await runLibrarian({
      chatId: '',
      transient: true,
      link: null,
      messages: [
        {
          id: 'a',
          role: 'assistant',
          metadata: { source: 'quick' },
          parts: [{ type: 'text', text: 'Earlier answer' }],
        },
      ],
    });
    await response.text();
    expect(model.doStreamCalls[0]?.prompt).toContainEqual({
      role: 'user',
      content: expect.arrayContaining([
        {
          type: 'text',
          text: 'Quick answer the owner saw earlier (read-only, not your own words): Earlier answer',
        },
      ]),
    });
  });
  it('aborts the transient model call when the request is aborted', async () => {
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    const controller = new AbortController();
    const aborted = vi.fn();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        abortSignal?.addEventListener('abort', aborted, { once: true });
        started();
        return {
          stream: new ReadableStream({
            start(c) {
              abortSignal?.addEventListener('abort', () => c.close(), { once: true });
            },
          }),
        };
      },
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const response = await runLibrarian({
      chatId: '',
      transient: true,
      link: null,
      abortSignal: controller.signal,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    });
    const body = response.text();
    await ready;
    controller.abort();
    await body;
    expect(aborted).toHaveBeenCalledOnce();
    expect(model.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
  });
  it('frames imported assistant text as user data at the model boundary', async () => {
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    vi.mocked(getLibrarianToolSource).mockReturnValue(undefined);
    const model = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        expect(prompt).toContainEqual({
          role: 'user',
          content: expect.arrayContaining([
            {
              type: 'text',
              text: 'Quick answer the owner saw earlier (read-only, not your own words): Imported answer',
            },
          ]),
        });
        expect(prompt.some((message) => message.role === 'assistant')).toBe(false);
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        };
      },
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const response = await runLibrarian({
      chatId: 'chat',
      link: null,
      transient: true,
      messages: [
        {
          id: 'imported',
          role: 'assistant',
          metadata: { source: 'quick' },
          parts: [{ type: 'text', text: 'Imported answer' }],
        },
      ],
    });
    await response.text();
    expect(model.doStreamCalls).toHaveLength(1);
  });
  it('passes request cancellation to the transient model call', async () => {
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    vi.mocked(getLibrarianToolSource).mockReturnValue(undefined);
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        observed = abortSignal;
        controller.abort();
        return {
          stream: new ReadableStream({
            start(stream) {
              stream.close();
            },
          }),
        };
      },
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const response = await runLibrarian({
      chatId: '',
      transient: true,
      link: null,
      abortSignal: controller.signal,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    });
    await response.text();
    expect(observed?.aborted).toBe(true);
  });
  it('returns a fixed error without provider details', async () => {
    vi.mocked(resolveAiFeatureCredential).mockRejectedValue(
      Object.assign(new Error('secret'), { statusCode: 401 }),
    );
    const endRun = vi.fn();
    const response = await runLibrarian({ chatId: 'chat', messages: [], link: null, endRun });
    expect(endRun).toHaveBeenCalled();
    const body = await response.text();
    expect(body).toContain('invalid_key');
    expect(body).not.toContain('secret');
  });
  it.each([
    { name: 'get_link', input: { id: 'link1' } },
    { name: 'edit_link', input: { id: 'link1', title: 'New title' } },
    { name: 'edit_highlight', input: { id: 'link1', color: 'yellow' } },
    { name: 'rename_tag', input: { name: 'a', newName: 'b', merge: false } },
  ])('executes a direct $name edit', async ({ name, input }) => {
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    const call = vi.fn(
      async (_name: string, _args: Record<string, unknown>, _signal?: AbortSignal) => ({
        text: 'Found article',
        isError: false,
      }),
    );
    vi.mocked(getLibrarianToolSource).mockReturnValue({
      list: async () => [
        {
          name,
          description: 'Read link',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      ],
      call,
    });
    let step = 0;
    vi.mocked(languageModelFor).mockReturnValue(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              if (step++ === 0)
                c.enqueue({
                  type: 'tool-call',
                  toolCallId: 'call1',
                  toolName: name,
                  input: JSON.stringify(input),
                });
              else {
                c.enqueue({ type: 'text-start', id: 't' });
                c.enqueue({ type: 'text-delta', id: 't', delta: 'Read it' });
                c.enqueue({ type: 'text-end', id: 't' });
              }
              c.enqueue({
                type: 'finish',
                finishReason: { unified: step === 1 ? 'tool-calls' : 'stop', raw: undefined },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              });
              c.close();
            },
          }),
        }),
      }),
    );
    const endRun = vi.fn();
    const response = await runLibrarian({
      endRun,
      chatId: 'chat',
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Read' }] }],
      link: null,
    });
    expect(await response.text()).toContain('Found article');
    expect(call).toHaveBeenCalledWith(name, input, undefined);
  });
  it.each([
    ...[true, false].flatMap((approved) => [
      { name: 'trash_link', input: { id: 'link1' }, approved },
      ...['edit_link', 'edit_highlight'].flatMap((name) =>
        ['', 'new note', null].map((note) => ({ name, input: { id: 'link1', note }, approved })),
      ),
      { name: 'rename_tag', input: { name: 'a', newName: 'b', merge: true }, approved },
    ]),
  ])('ends for signed approval and resumes with approved=%s', async ({ name, input, approved }) => {
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    const call = vi.fn(
      async (_name: string, _args: Record<string, unknown>, _signal?: AbortSignal) => ({
        text: 'Found article',
        isError: false,
      }),
    );
    vi.mocked(getLibrarianToolSource).mockReturnValue({
      list: async () => [
        {
          name,
          description: 'Read link',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
      ],
      call,
    });
    let step = 0;
    vi.mocked(languageModelFor).mockReturnValue(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              if (step++ === 0)
                c.enqueue({
                  type: 'tool-call',
                  toolCallId: 'call1',
                  toolName: name,
                  input: JSON.stringify(input),
                });
              else {
                c.enqueue({ type: 'text-start', id: 't' });
                c.enqueue({ type: 'text-delta', id: 't', delta: 'Read it' });
                c.enqueue({ type: 'text-end', id: 't' });
              }
              c.enqueue({
                type: 'finish',
                finishReason: { unified: step === 1 ? 'tool-calls' : 'stop', raw: undefined },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              });
              c.close();
            },
          }),
        }),
      }),
    );
    const endRun = vi.fn();
    const response = await runLibrarian({
      endRun,
      chatId: 'chat',
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Read' }] }],
      link: null,
    });
    const pausedBody = await response.text();
    expect(pausedBody).toContain('tool-approval-request');
    expect(pausedBody).not.toContain('data-suggestions');
    expect(step).toBe(1);
    expect(call).not.toHaveBeenCalled();
    const saved = structuredClone(vi.mocked(saveChatMessages).mock.calls.at(-1)?.[1]);
    if (!saved) throw new Error('missing persisted approval');
    const assistant = saved.at(-1);
    if (!assistant) throw new Error('missing assistant');
    assistant.parts = assistant.parts.map((part) => {
      if (
        !part ||
        typeof part !== 'object' ||
        !('state' in part) ||
        part.state !== 'approval-requested' ||
        !('approval' in part)
      )
        return part;
      return {
        ...part,
        state: 'approval-responded',
        approval: { ...(part.approval as Record<string, unknown>), approved },
      };
    });
    const resumed = await runLibrarian({ chatId: 'chat', messages: saved, link: null });
    await resumed.text();
    if (approved) expect(call).toHaveBeenCalledExactlyOnceWith(name, input, undefined);
    else expect(call).not.toHaveBeenCalled();
  });
  it('maps streamed provider errors to fixed codes', async () => {
    const spies = ['error', 'warn', 'log'].map((method) =>
      vi.spyOn(console, method as 'error').mockImplementation(() => {}),
    );
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
    vi.mocked(getLibrarianToolSource).mockReturnValue(undefined);
    vi.mocked(languageModelFor).mockReturnValue(
      new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              c.enqueue({
                type: 'error',
                error: Object.assign(new Error('SENTINEL_SECRET'), { statusCode: 401 }),
              });
              c.close();
            },
          }),
        }),
      }),
    );
    const endRun = vi.fn();
    const response = await runLibrarian({
      endRun,
      chatId: 'chat',
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      link: null,
    });
    const body = await response.text();
    expect(body).toContain('invalid_key');
    expect(endRun).toHaveBeenCalled();
    expect(body).not.toContain('SENTINEL_SECRET');
    for (const spy of spies) {
      expect(spy.mock.calls.flat().map(String).join(' ')).not.toContain('SENTINEL_SECRET');
      spy.mockRestore();
    }
  });
});

it('keeps system instructions stable and appends context only to the last user turn', async () => {
  vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
  vi.mocked(getLibrarianToolSource).mockReturnValue(undefined);
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
  });
  vi.mocked(languageModelFor).mockReturnValue(model);
  const messages = [
    { id: 'old', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Earlier' }] },
    {
      id: 'u',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'Hi' }],
      metadata: { selection: 'first' },
    },
  ];
  const before = structuredClone(messages);
  try {
    for (const [day, selection] of [
      ['2026-11-01', 'first'],
      ['2026-11-02', 'second'],
    ]) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(day ?? ''));
      const response = await runLibrarian({
        chatId: '',
        transient: true,
        link: {
          id: selection ?? '',
          title: selection ?? '',
          url: 'https://example.com',
          site: null,
        },
        messages: messages.map((message) =>
          message.id === 'u' ? { ...message, metadata: { selection } } : message,
        ),
      });
      await response.text();
    }
  } finally {
    vi.useRealTimers();
  }
  expect(messages).toEqual(before);
  const first = model.doStreamCalls[0];
  const second = model.doStreamCalls[1];
  expect(first?.prompt.filter((message) => message.role === 'system')).toEqual(
    second?.prompt.filter((message) => message.role === 'system'),
  );
  expect(first?.prompt.find((message) => message.role === 'user')?.content).toEqual([
    { type: 'text', text: 'Earlier' },
  ]);
  expect(JSON.stringify(first?.prompt.at(-1))).toContain('Request context (data)');
  expect(JSON.stringify(first?.prompt.at(-1))).toContain('2026-11-01');
  expect(JSON.stringify(second?.prompt.at(-1))).toContain('second');
  expect(first?.providerOptions?.anthropic).toHaveProperty('cacheControl', { type: 'ephemeral' });
});

it('caches a history prefix that the next turn replays unchanged', async () => {
  vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
  vi.mocked(getLibrarianToolSource).mockReturnValue(undefined);
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
  });
  vi.mocked(languageModelFor).mockReturnValue(model);
  const turn = (id: string, role: 'user' | 'assistant', text: string) => ({
    id,
    role,
    parts: [{ type: 'text' as const, text }],
    metadata: role === 'user' ? { selection: id } : undefined,
  });
  const history = [turn('u1', 'user', 'One'), turn('a1', 'assistant', 'Reply one')];
  for (const messages of [
    [...history, turn('u2', 'user', 'Two')],
    [
      ...history,
      turn('u2', 'user', 'Two'),
      turn('a2', 'assistant', 'Reply two'),
      turn('u3', 'user', 'Three'),
    ],
  ]) {
    const response = await runLibrarian({ chatId: '', transient: true, link: null, messages });
    await response.text();
  }
  const breakpoint = (prompt: { providerOptions?: unknown }[]) =>
    prompt.findIndex((message) =>
      JSON.stringify(message.providerOptions ?? {}).includes('cacheControl'),
    );
  const withoutMarks = (prompt: object[]) =>
    prompt.map(({ providerOptions: _, ...message }: { providerOptions?: unknown }) => message);
  const first = model.doStreamCalls[0]?.prompt ?? [];
  const second = model.doStreamCalls[1]?.prompt ?? [];
  const firstMark = breakpoint(first);
  expect(first[firstMark]).toMatchObject({ role: 'assistant' });
  expect(breakpoint(second)).toBeGreaterThan(firstMark);
  expect(withoutMarks(second.slice(0, firstMark + 1))).toEqual(
    withoutMarks(first.slice(0, firstMark + 1)),
  );
});

it.each(['openai', 'anthropic'] as const)(
  'retries a %s 400 before output and remembers the rejected option',
  async (kind) => {
    const selected = {
      ...credential,
      kind,
      model: {
        ...credential.model,
        id: `fallback-${kind}`,
        reasoning:
          kind === 'openai'
            ? { type: 'openai' as const, effort: 'low' as const }
            : { type: 'anthropic' as const, thinking: 'adaptive' as const },
      },
    };
    vi.mocked(resolveAiFeatureCredential).mockResolvedValue(selected);
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        const provider = options.providerOptions?.[kind];
        if (
          provider?.reasoningSummary ||
          (provider?.thinking as { display?: string } | undefined)?.display
        )
          throw new APICallError({
            message:
              kind === 'openai'
                ? 'Unsupported parameter: reasoningSummary'
                : 'Unsupported parameter: thinking.display',
            url: 'https://test.invalid',
            requestBodyValues: {},
            statusCode: 400,
            isRetryable: false,
          });
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'text-start', id: 't' });
              c.enqueue({ type: 'text-delta', id: 't', delta: 'Recovered' });
              c.enqueue({ type: 'text-end', id: 't' });
              c.close();
            },
          }),
        };
      },
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    for (let i = 0; i < 2; i++) {
      const response = await runLibrarian({
        chatId: '',
        transient: true,
        messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
        link: null,
      });
      expect(await response.text()).toContain('Recovered');
    }
    expect(model.doStreamCalls).toHaveLength(3);
  },
);

it('does not retry a rejected option after text has streamed', async () => {
  vi.mocked(resolveAiFeatureCredential).mockResolvedValue(credential);
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'text-start', id: 't' });
          c.enqueue({ type: 'text-delta', id: 't', delta: 'Already sent' });
          c.enqueue({
            type: 'error',
            error: new APICallError({
              message: 'Unsupported parameter: thinking.display',
              url: 'https://test.invalid',
              requestBodyValues: {},
              statusCode: 400,
              isRetryable: false,
            }),
          });
          c.close();
        },
      }),
    }),
  });
  vi.mocked(languageModelFor).mockReturnValue(model);
  const response = await runLibrarian({
    chatId: '',
    transient: true,
    messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    link: null,
  });
  expect(await response.text()).toContain('Already');
  expect(model.doStreamCalls).toHaveLength(1);
});
