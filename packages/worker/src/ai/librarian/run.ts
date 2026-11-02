import { librarianMessageSchema, saveChatMessages } from '@silo/core';
import {
  getLibrarianToolSource,
  type LibrarianRequest,
  resolveAiFeatureCredential,
} from '@silo/core/ai-credential';
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from 'ai';
import { aiErrorCode, logAiFailure } from '../errors.js';
import { chatModelSettings } from '../generation.js';
import { languageModelFor } from '../model.js';
import { persona, promptVersion, requestContext } from './persona.js';
import { librarianTools } from './tools.js';

function failure(error: unknown): string {
  const code = aiErrorCode(error);
  logAiFailure('librarian', promptVersion, code);
  return code;
}
export async function runLibrarian(request: LibrarianRequest): Promise<Response> {
  try {
    const credential = await resolveAiFeatureCredential('librarian');
    if (!credential) throw new Error('Unavailable');
    const tools = await librarianTools(getLibrarianToolSource());
    const originalMessages = await validateUIMessages({
      messages: request.messages,
      tools: Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [name, { inputSchema: tool.inputSchema }]),
      ),
    });
    const result = streamText({
      model: languageModelFor(credential),
      instructions: `${persona}\nRequest context (data):\n${requestContext(request)}`,
      messages: await convertToModelMessages(originalMessages),
      tools,
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
        await saveChatMessages(
          request.chatId,
          messages.map((message) => librarianMessageSchema.parse(message)),
        );
      },
    });
    // Consume the UI stream too: its onEnd persists after the HTTP reader disconnects.
    const [responseStream, persistenceStream] = stream.tee();
    void persistenceStream.pipeTo(new WritableStream({ write() {} })).catch(() => {});
    void result.consumeStream();
    return createUIMessageStreamResponse({ stream: responseStream });
  } catch (error) {
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
