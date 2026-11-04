import { librarianMessageSchema, saveChatMessages } from '@silo/core';
import {
  getLibrarianToolSource,
  type LibrarianRequest,
  librarianApprovalSecret,
  resolveAiFeatureCredential,
} from '@silo/core/ai-credential';
import {
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  type ModelMessage,
  smoothStream,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from 'ai';
import { aiErrorCode, logAiFailure } from '../errors.js';
import { chatModelSettings, chatStreamingModel } from '../generation.js';
import { languageModelFor } from '../model.js';
import { compactConversation } from './compaction.js';
import { persona, promptVersion, requestContext } from './persona.js';
import { reasoningTiming } from './reasoning-time.js';
import { librarianTools, toolApproval } from './tools.js';

/**
 * The per-turn context rides on the latest user message only, so next turn's replay differs
 * there. A breakpoint just before it caches the history prefix the next turn sends unchanged.
 */
function withRequestContext(messages: ModelMessage[], context: string): ModelMessage[] {
  const lastUser = messages.findLastIndex((message) => message.role === 'user');
  return messages.map((message, index) => {
    if (index === lastUser - 1)
      return {
        ...message,
        providerOptions: {
          ...message.providerOptions,
          anthropic: { ...message.providerOptions?.anthropic, cacheControl: { type: 'ephemeral' } },
        },
      } as ModelMessage;
    if (index !== lastUser || message.role !== 'user') return message;
    const content =
      typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : message.content;
    return {
      ...message,
      content: [...content, { type: 'text', text: `Request context (data):\n${context}` }],
    };
  });
}

/** Provider-specific chunks (message ids, token usage) stay on the server. */
function withoutProviderChunks<Part extends { type: string }>() {
  return new TransformStream<Part, Part>({
    transform(part, controller) {
      if (part.type !== 'custom') controller.enqueue(part);
    },
  });
}

function failure(error: unknown): string {
  const code = aiErrorCode(error);
  logAiFailure('librarian', promptVersion, code);
  return code;
}
export async function runLibrarian(request: LibrarianRequest): Promise<Response> {
  try {
    const credential = await resolveAiFeatureCredential('librarian');
    if (!credential) throw new Error('Unavailable');
    const approvalSecret = librarianApprovalSecret();
    const tools = await librarianTools(getLibrarianToolSource(), approvalSecret, request.transient);
    const originalMessages = await validateUIMessages({
      messages: request.messages,
      tools: Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [name, { inputSchema: tool.inputSchema }]),
      ),
    });
    const model = languageModelFor(credential);
    const input = await compactConversation(request, originalMessages, credential, model, persona);
    const last = originalMessages.at(-1);
    const parsedLast = last?.role === 'assistant' ? librarianMessageSchema.parse(last) : undefined;
    const timing = reasoningTiming(
      typeof parsedLast?.metadata?.reasoningMs === 'number' ? parsedLast.metadata.reasoningMs : 0,
    );
    const result = streamText({
      model: chatStreamingModel(model, credential),
      // The UI stream logs the fixed code; the SDK default logs raw provider errors.
      onError: () => {},
      ...input,
      messages: withRequestContext(input.messages, requestContext(request)),
      experimental_transform: [
        timing.transform,
        withoutProviderChunks,
        smoothStream({ chunking: new Intl.Segmenter(undefined, { granularity: 'word' }) }),
      ],
      tools,
      toolApproval,
      ...(approvalSecret ? { experimental_toolApprovalSecret: approvalSecret } : {}),
      stopWhen: isStepCount(8),
      maxRetries: 2,
      telemetry: { isEnabled: false },
      ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      ...chatModelSettings(credential, { promptCache: true, readableReasoning: true }),
    });
    const replyStream = toUIMessageStream({
      stream: result.stream,
      originalMessages,
      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
      messageMetadata: ({ part }) =>
        part.type === 'finish'
          ? { ...timing.messageMetadata({ part }), finalAnswer: part.finishReason === 'stop' }
          : timing.messageMetadata({ part }),
      onError: failure,
    });
    const stream = createUIMessageStream({
      originalMessages,
      execute: ({ writer }) => {
        writer.merge(replyStream);
      },
      onError: failure,
      onEnd: async ({ messages }) => {
        try {
          if (!request.transient)
            await saveChatMessages(
              request.chatId,
              messages.map((message) => librarianMessageSchema.parse(message)),
            );
        } finally {
          request.endRun?.();
        }
      },
    });
    if (request.transient) return createUIMessageStreamResponse({ stream });
    // Consume the UI stream too: its onEnd persists after the HTTP reader disconnects.
    const [responseStream, persistenceStream] = stream.tee();
    void persistenceStream
      .pipeTo(new WritableStream({ write() {} }))
      .catch(() => {})
      .finally(() => request.endRun?.());
    void result.consumeStream();
    return createUIMessageStreamResponse({ stream: responseStream });
  } catch (error) {
    request.endRun?.();
    const code = failure(error);
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: 'error', errorText: code });
        },
        onError: () => code,
      }),
    });
  }
}
