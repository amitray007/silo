import {
  createChat,
  deleteChat,
  getChat,
  importLibrarianMessages,
  importMessagesSchema,
  incomingUserMessageSchema,
  librarianMessageSchema,
  listChats,
  quickLibrarianReply,
  quickRequestSchema,
  streamLibrarianReply,
} from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { operatorOnly } from '../operator-only.js';

const chatId = z.string().uuid();
function summary(chat: NonNullable<Awaited<ReturnType<typeof createChat>>>) {
  return {
    id: chat.id,
    title: chat.title,
    linkId: chat.linkId,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}
export function registerLibrarianRoutes(app: Hono): void {
  app.use('/librarian/*', operatorOnly);
  app.post('/librarian/quick', async (c) => {
    const input = quickRequestSchema.parse(await c.req.json());
    const result = await quickLibrarianReply(input, c.req.raw.signal);
    if (result.ok) return result.response;
    return c.json(
      { error: result.code, message: 'Could not start Librarian reply.' },
      result.code === 'ai_not_ready' || result.code === 'busy'
        ? 409
        : result.code === 'not_found'
          ? 404
          : 503,
    );
  });
  app.post('/librarian/chats/:id/import', async (c) => {
    const id = chatId.parse(c.req.param('id'));
    const input = importMessagesSchema.parse(await c.req.json());
    const result = await importLibrarianMessages(id, input.messages);
    if (result === 'ok') return c.body(null, 204);
    return c.json(
      { error: result, message: 'Could not import conversation.' },
      result === 'not_found' ? 404 : 409,
    );
  });
  app.get('/librarian/chats', async (c) => {
    const query = z
      .object({
        linkId: chatId.optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().positive().optional(),
      })
      .parse(c.req.query());
    const result = await listChats(query);
    return c.json({ chats: result.chats.map(summary), nextCursor: result.nextCursor });
  });
  app.post('/librarian/chats', async (c) => {
    const body = z
      .object({ linkId: chatId.optional() })
      .strict()
      .parse(await c.req.json());
    const chat = await createChat(body);
    return chat
      ? c.json(summary(chat), 201)
      : c.json({ error: 'not_found', message: 'Link not found.' }, 404);
  });
  app.get('/librarian/chats/:id', async (c) => {
    const result = await getChat(chatId.parse(c.req.param('id')));
    return result
      ? c.json({ chat: summary(result.chat), messages: result.messages })
      : c.json({ error: 'not_found', message: 'Chat not found.' }, 404);
  });
  app.delete('/librarian/chats/:id', async (c) => {
    await deleteChat(chatId.parse(c.req.param('id')));
    return c.body(null, 204);
  });
  app.post('/librarian/chats/:id/messages', async (c) => {
    const id = chatId.parse(c.req.param('id'));
    const parsed = z
      .object({
        message: z.union([
          incomingUserMessageSchema,
          librarianMessageSchema.extend({ role: z.literal('assistant') }).strict(),
        ]),
      })
      .strict()
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'invalid_message' }, 400);
    const { message } = parsed.data;
    const result = await streamLibrarianReply({ chatId: id, message });
    if (result.ok) return result.response;
    const status = {
      ai_not_ready: 409,
      busy: 409,
      unavailable: 503,
      not_found: 404,
      invalid_message: 400,
    } as const;
    return c.json(
      { error: result.code, message: 'Could not start Librarian reply.' },
      status[result.code],
    );
  });
}
