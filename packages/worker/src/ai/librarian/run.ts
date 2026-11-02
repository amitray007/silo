import { librarianMessageSchema, saveChatMessages } from '@silo/core';
import {
  getLibrarianToolSource,
  type LibrarianRequest,
  librarianApprovalSecret,
  resolveAiFeatureCredential,
} from '@silo/core/ai-credential';
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  pruneMessages,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from 'ai';
import { aiErrorCode, logAiFailure } from '../errors.js';
import { chatModelSettings } from '../generation.js';
import { languageModelFor } from '../model.js';
import { stubOldToolResults } from './history.js';
import { persona, promptVersion, requestContext } from './persona.js';
import { librarianTools, toolApproval } from './tools.js';

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
    const result = streamText({
      model: languageModelFor(credential),
      // The UI stream logs the fixed code; the SDK default logs raw provider errors.
      onError: () => {},
      instructions: `${persona}\nRequest context (data):\n${requestContext(request)}`,
      messages: stubOldToolResults(
        pruneMessages({
          messages: await convertToModelMessages(originalMessages),
          reasoning: 'before-last-message',
          emptyMessages: 'remove',
        }),
      ),
      experimental_transform: withoutProviderChunks,
      tools,
      toolApproval,
      ...(approvalSecret ? { experimental_toolApprovalSecret: approvalSecret } : {}),
      stopWhen: isStepCount(8),
      maxRetries: 2,
      telemetry: { isEnabled: false },
      ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      ...chatModelSettings(credential),
    });
    const stream = toUIMessageStream({
      stream: result.stream,
      originalMessages,
      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
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
