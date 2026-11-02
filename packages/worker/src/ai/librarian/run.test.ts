import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credential } from '../test-helpers.js';

vi.mock('@silo/core', () => ({
  saveChatMessages: vi.fn(),
  librarianMessageSchema: { parse: (m: unknown) => m },
}));
vi.mock('@silo/core/ai-credential', () => ({
  resolveAiFeatureCredential: vi.fn(),
  getLibrarianToolSource: vi.fn(),
  librarianApprovalSecret: vi.fn(() => new Uint8Array(32)),
}));
vi.mock('../model.js', () => ({ languageModelFor: vi.fn() }));

import { saveChatMessages } from '@silo/core';
import { getLibrarianToolSource, resolveAiFeatureCredential } from '@silo/core/ai-credential';
import { languageModelFor } from '../model.js';
import { runLibrarian } from './run.js';

afterEach(() => vi.clearAllMocks());
describe('Librarian streaming', () => {
  it.each([false, true])(
    'streams text and persists only durable replies (transient=%s)',
    async (transient) => {
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
      expect(await response.text()).toContain('Hello');
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
  it('executes a model tool call through the tool source', async () => {
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
          name: 'get_link',
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
                  toolName: 'get_link',
                  input: JSON.stringify({ id: 'link1' }),
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
    expect(call).toHaveBeenCalledWith('get_link', { id: 'link1' }, undefined);
  });
  it.each([true, false])(
    'ends for signed approval and resumes with approved=%s',
    async (approved) => {
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
            name: 'trash_link',
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
                    toolName: 'trash_link',
                    input: JSON.stringify({ id: 'link1' }),
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
      expect(await response.text()).toContain('tool-approval-request');
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
      if (approved)
        expect(call).toHaveBeenCalledExactlyOnceWith('trash_link', { id: 'link1' }, undefined);
      else expect(call).not.toHaveBeenCalled();
    },
  );
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
