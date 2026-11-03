import { librarianChats as chats, db, links, librarianMessages as messages } from '@silo/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { isAiFeatureOn } from '../ai/status.js';
import { decodeListCursor, encodeListCursor } from '../links/pagination.js';
import { beginLibrarianRun, getLibrarianRunner } from './ports.js';
import { incomingUserMessageSchema, type LibrarianMessage } from './types.js';

export {
  incomingUserMessageSchema,
  type LibrarianMessage,
  librarianMessageSchema,
} from './types.js';

const PLACEHOLDER = 'New chat';
export async function createChat({ linkId }: { linkId?: string | undefined } = {}) {
  return db.transaction(async (tx) => {
    if (linkId) {
      const [link] = await tx
        .select({ id: links.id })
        .from(links)
        .where(and(eq(links.id, linkId), isNull(links.deletedAt)))
        .for('share');
      if (!link) return null;
    }
    const [chat] = await tx
      .insert(chats)
      .values({ linkId: linkId ?? null, title: PLACEHOLDER })
      .returning();
    return chat ?? null;
  });
}
export async function listChats({
  linkId,
  cursor,
  limit = 20,
}: {
  linkId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
} = {}) {
  const size = Math.max(1, Math.min(100, Math.trunc(limit)));
  const key = cursor ? decodeListCursor(cursor) : null;
  const rows = await db
    .select({ chat: chats, timestamp: sql<string>`${chats.updatedAt}::text` })
    .from(chats)
    .where(
      and(
        linkId ? eq(chats.linkId, linkId) : undefined,
        key
          ? sql`(${chats.updatedAt} < ${key.createdAt}::timestamptz OR (${chats.updatedAt} = ${key.createdAt}::timestamptz AND ${chats.id} > ${key.id}::uuid))`
          : undefined,
      ),
    )
    .orderBy(desc(chats.updatedAt), asc(chats.id))
    .limit(size + 1);
  const page = rows.slice(0, size);
  const last = page.at(-1);
  return {
    chats: page.map((r) => r.chat),
    nextCursor: rows.length > size && last ? encodeListCursor(last.timestamp, last.chat.id) : null,
  };
}
export async function getChat(id: string) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, id));
  if (!chat) return null;
  const stored = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, id))
    .orderBy(asc(messages.seq));
  return {
    chat,
    messages: stored.map(({ id, role, parts, metadata }) => ({
      id,
      role,
      parts,
      ...(metadata === null ? {} : { metadata }),
    })),
  };
}
export async function deleteChat(id: string) {
  await db.delete(chats).where(eq(chats.id, id));
}
function messageTitle(message: LibrarianMessage): string {
  const metadata = message.metadata as { action?: unknown; quote?: unknown } | undefined;
  if (metadata?.action && typeof metadata.quote === 'string')
    return metadata.quote.trim().slice(0, 60);
  for (const part of message.parts) {
    if (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'text' &&
      'text' in part &&
      typeof part.text === 'string'
    )
      return part.text.trim().slice(0, 60);
  }
  return '';
}
export async function saveChatMessages(
  chatId: string,
  incoming: LibrarianMessage[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const [chat] = await tx.select().from(chats).where(eq(chats.id, chatId)).for('update');
    if (!chat) return;
    const stored = await tx
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.seq));
    let seq = (stored.at(-1)?.seq ?? 0) + 1;
    const sequences = new Map(stored.map((message) => [message.id, message.seq]));
    for (const message of incoming) {
      const sequence = sequences.get(message.id) ?? seq++;
      sequences.set(message.id, sequence);
      // A message id owned by another chat must never be overwritten.
      await tx
        .insert(messages)
        .values({
          ...message,
          metadata: message.metadata ?? null,
          chatId,
          seq: sequence,
        })
        .onConflictDoUpdate({
          target: messages.id,
          set: { parts: message.parts, metadata: message.metadata ?? null, role: message.role },
          setWhere: eq(messages.chatId, chatId),
        });
    }
    const first = stored.find((m) => m.role === 'user') ?? incoming.find((m) => m.role === 'user');
    await tx
      .update(chats)
      .set({
        updatedAt: new Date(),
        ...(chat.title === PLACEHOLDER && first && messageTitle(first)
          ? { title: messageTitle(first) }
          : {}),
      })
      .where(eq(chats.id, chatId));
  });
}
export async function streamLibrarianReply({
  chatId,
  message,
  abortSignal,
}: {
  chatId: string;
  message: LibrarianMessage;
  abortSignal?: AbortSignal;
}) {
  if (!(await isAiFeatureOn('librarian'))) return { ok: false, code: 'ai_not_ready' } as const;
  const stored = await getChat(chatId);
  if (!stored) return { ok: false, code: 'not_found' } as const;
  const runner = getLibrarianRunner();
  if (!runner) return { ok: false, code: 'unavailable' } as const;
  if (!incomingUserMessageSchema.safeParse(message).success)
    return { ok: false, code: 'invalid_message' } as const;
  const [existing] = await db
    .select({ chatId: messages.chatId })
    .from(messages)
    .where(eq(messages.id, message.id));
  if (existing && existing.chatId !== chatId)
    return { ok: false, code: 'invalid_message' } as const;
  const endRun = beginLibrarianRun(chatId);
  if (!endRun) return { ok: false, code: 'busy' } as const;
  try {
    const merged = [...stored.messages, message];
    await saveChatMessages(chatId, [message]);
    const [link] = stored.chat.linkId
      ? await db
          .select({ id: links.id, title: links.title, url: links.url, site: links.siteName })
          .from(links)
          .where(and(eq(links.id, stored.chat.linkId), isNull(links.deletedAt)))
      : [];
    return {
      ok: true,
      response: await runner({ chatId, messages: merged, link: link ?? null, abortSignal, endRun }),
    } as const;
  } catch (error) {
    endRun();
    throw error;
  }
}
