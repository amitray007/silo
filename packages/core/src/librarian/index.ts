import { librarianChats as chats, db, links, librarianMessages as messages } from '@silo/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { isAiFeatureOn, resolveAiCredential } from '../ai/status.js';
import { decodeListCursor, encodeListCursor } from '../links/pagination.js';
import { resolveAction, resolveMessageAction } from './action-resolution.js';
import { isApprovalContinuation } from './approval.js';
import { beginLibrarianRun, getLibrarianRunner } from './ports.js';
import {
  incomingUserMessageSchema,
  type LibrarianMessage,
  librarianMessageSchema,
  type regenerateRequestSchema,
} from './types.js';

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
    .select({
      chat: chats,
      linkTitle: links.title,
      timestamp: sql<string>`${chats.updatedAt}::text`,
    })
    .from(chats)
    .leftJoin(links, and(eq(chats.linkId, links.id), isNull(links.deletedAt)))
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
    chats: page.map((r) => ({ ...r.chat, linkTitle: r.linkTitle })),
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
    summarizedCount: stored.filter((message) => message.seq <= chat.summaryThrough).length,
    messageSeqs: stored.map((message) => message.seq),
    messages: stored.map(({ id, role, parts, metadata }) => ({
      id,
      role,
      parts,
      ...(metadata === null ? {} : { metadata }),
    })),
  };
}
export async function saveChatSummary(chatId: string, summary: string, throughSeq: number) {
  await db
    .update(chats)
    .set({ summary, summaryThrough: throughSeq })
    .where(and(eq(chats.id, chatId), sql`${chats.summaryThrough} < ${throughSeq}`));
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
          set: {
            parts: message.parts,
            metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify(message.metadata ?? {})}::jsonb`,
            role: message.role,
          },
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
async function resolveTurn(
  stored: NonNullable<Awaited<ReturnType<typeof getChat>>>,
  incoming: LibrarianMessage | undefined,
  regenerate: import('zod').z.infer<typeof regenerateRequestSchema> | undefined,
) {
  let message = incoming;
  let replacing: LibrarianMessage | undefined;
  let selected: Awaited<ReturnType<typeof resolveAiCredential>>;
  if (regenerate) {
    const last = stored.messages.at(-1);
    if (!last || last.id !== regenerate.messageId || last.role !== 'assistant')
      return { code: 'invalid_message' } as const;
    if (last.parts.some((p) => (p as { state?: string }).state === 'approval-requested'))
      return { code: 'approval_pending' } as const;
    replacing = last;
    message = stored.messages.at(-2);
    if (message?.role !== 'user') return { code: 'invalid_message' } as const;
    if (regenerate.model) {
      selected = await resolveAiCredential(regenerate.model.provider, regenerate.model.id);
      if (!selected) return { code: 'invalid_model' } as const;
    }
  }
  return { message, replacing, selected };
}
async function replyContext(
  saved: NonNullable<Awaited<ReturnType<typeof getChat>>>,
  replacing: LibrarianMessage | undefined,
  selected: Awaited<ReturnType<typeof resolveAiCredential>>,
) {
  const [link] = saved.chat.linkId
    ? await db
        .select({ id: links.id, title: links.title, url: links.url, site: links.siteName })
        .from(links)
        .where(and(eq(links.id, saved.chat.linkId), isNull(links.deletedAt)))
    : [];
  const { ownerAction } = await resolveMessageAction(saved.messages, saved.chat.linkId);
  return {
    ...(ownerAction ? { ownerAction } : {}),
    ...(selected ? { model: { ...selected.model, provider: selected.kind } } : {}),
    ...(replacing ? { replacing } : {}),
    messages: replacing ? saved.messages.slice(0, -1) : saved.messages,
    summary: replacing ? null : saved.chat.summary,
    summarizedCount: replacing ? 0 : saved.summarizedCount,
    messageSeqs: saved.messageSeqs,
    link: link ?? null,
  };
}
export async function streamLibrarianReply({
  chatId,
  message: incoming,
  regenerate,
  abortSignal,
}: {
  chatId: string;
  message?: LibrarianMessage;
  regenerate?: import('zod').z.infer<typeof regenerateRequestSchema>;
  abortSignal?: AbortSignal;
}) {
  if (!(await isAiFeatureOn('librarian'))) return { ok: false, code: 'ai_not_ready' } as const;
  const endRun = beginLibrarianRun(chatId);
  if (!endRun) return { ok: false, code: 'busy' } as const;
  function fail<
    Code extends
      | 'not_found'
      | 'unavailable'
      | 'invalid_message'
      | 'unknown_action'
      | 'invalid_model'
      | 'approval_pending',
  >(code: Code) {
    endRun?.();
    return { ok: false, code } as const;
  }
  try {
    const stored = await getChat(chatId);
    if (!stored) return fail('not_found');
    const runner = getLibrarianRunner();
    if (!runner) return fail('unavailable');
    const turn = await resolveTurn(stored, incoming, regenerate);
    if ('code' in turn) return fail(turn.code);
    const { message, replacing, selected } = turn;
    if (!message) return fail('invalid_message');
    const continuation = isApprovalContinuation(message, stored.messages.at(-1));
    if (!continuation && !incomingUserMessageSchema.safeParse(message).success)
      return fail('invalid_message');
    const incomingAction = await resolveMessageAction([message], stored.chat.linkId);
    if (!continuation && !incomingAction.valid) return fail('unknown_action');
    const [existing] = await db
      .select({ chatId: messages.chatId })
      .from(messages)
      .where(eq(messages.id, message.id));
    if (existing && existing.chatId !== chatId) return fail('invalid_message');
    if (!regenerate) await saveChatMessages(chatId, [message]);
    const saved = await getChat(chatId);
    if (!saved) return fail('not_found');
    const context = await replyContext(saved, replacing, selected);
    return {
      ok: true,
      response: await runner({
        ...context,
        chatId,
        abortSignal,
        endRun,
      }),
    } as const;
  } catch (error) {
    endRun();
    throw error;
  }
}

export { importMessagesSchema, quickRequestSchema } from './types.js';

let activeQuickRuns = 0;
export async function quickLibrarianReply(
  input: {
    linkId: string;
    action: string;
    quote: string;
    paragraph: number;
  },
  abortSignal?: AbortSignal,
) {
  if (!(await isAiFeatureOn('librarian'))) return { ok: false, code: 'ai_not_ready' } as const;
  const runner = getLibrarianRunner();
  if (!runner) return { ok: false, code: 'unavailable' } as const;
  if (activeQuickRuns >= 2) return { ok: false, code: 'busy' } as const;
  activeQuickRuns++;
  let released = false;
  const endRun = () => {
    if (!released) {
      released = true;
      activeQuickRuns--;
    }
  };
  // A cancelled stream may never reach the runner's onEnd; free the slot on abort too.
  abortSignal?.addEventListener('abort', endRun, { once: true });
  try {
    const [link] = await db
      .select({ id: links.id, title: links.title, url: links.url, site: links.siteName })
      .from(links)
      .where(and(eq(links.id, input.linkId), isNull(links.deletedAt)));
    if (!link) {
      endRun();
      return { ok: false, code: 'not_found' } as const;
    }
    const { valid, ownerAction } = await resolveAction('passage', input.action);
    if (!valid) {
      endRun();
      return { ok: false, code: 'unknown_action' } as const;
    }
    return {
      ok: true,
      response: await runner({
        ...(ownerAction ? { ownerAction } : {}),
        chatId: '',
        transient: true,
        abortSignal,
        endRun,
        link,
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'user',
            parts: [{ type: 'text', text: ownerAction?.label ?? input.action }],
            metadata: { action: input.action, quote: input.quote, paragraph: input.paragraph },
          },
        ],
      }),
    } as const;
  } catch (error) {
    endRun();
    throw error;
  }
}
export async function importLibrarianMessages(chatId: string, incoming: LibrarianMessage[]) {
  if (!(await isAiFeatureOn('librarian'))) return 'ai_not_ready';
  const release = beginLibrarianRun(chatId);
  if (!release) return 'busy';
  try {
    const stored = await getChat(chatId);
    if (!stored) return 'not_found';
    const last = stored.messages.at(-1);
    if (
      last?.role === 'assistant' &&
      last.parts.some((part) => (part as { state?: string }).state === 'approval-requested')
    )
      return 'approval_pending';
    const action = await resolveMessageAction(incoming, stored.chat.linkId);
    if (!action.valid) return 'unknown_action';
    await saveChatMessages(
      chatId,
      incoming.map((m) => ({
        ...m,
        metadata: m.role === 'assistant' ? { source: 'quick' } : m.metadata,
        id: crypto.randomUUID(),
      })),
    );
    return 'ok';
  } finally {
    release();
  }
}

export { regenerateRequestSchema } from './types.js';
export function answerVersion(message: LibrarianMessage) {
  const parsed = librarianMessageSchema.parse(message);
  const { versions: _versions, ...metadata } = parsed.metadata ?? {};
  return { id: message.id, parts: message.parts, metadata };
}
export async function replaceLastAnswer(
  chatId: string,
  expected: LibrarianMessage,
  answer: LibrarianMessage,
) {
  return db.transaction(async (tx) => {
    const [chat] = await tx.select().from(chats).where(eq(chats.id, chatId)).for('update');
    if (!chat) return false;
    const [last] = await tx
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.seq))
      .limit(1);
    if (
      !last ||
      last.id !== expected.id ||
      JSON.stringify(last.parts) !== JSON.stringify(expected.parts)
    )
      return false;
    await tx
      .update(messages)
      .set({ id: answer.id, parts: answer.parts, metadata: answer.metadata ?? null })
      .where(eq(messages.id, last.id));
    await tx
      .update(chats)
      .set({ updatedAt: new Date(), summary: null, summaryThrough: 0 })
      .where(eq(chats.id, chatId));
    return true;
  });
}
export async function selectLibrarianVersion(chatId: string, messageId: string, versionId: string) {
  const release = beginLibrarianRun(chatId);
  if (!release) return { ok: false, code: 'busy' } as const;
  try {
    const stored = await getChat(chatId);
    const last = stored?.messages.at(-1);
    if (!last || last.id !== messageId || last.role !== 'assistant')
      return { ok: false, code: 'invalid_message' } as const;
    if (last.parts.some((p) => (p as { state?: string }).state === 'approval-requested'))
      return { ok: false, code: 'approval_pending' } as const;
    const metadata = librarianMessageSchema.parse(last).metadata;
    const versions = metadata?.versions ?? [];
    const index = versions.findIndex((v) => v.id === versionId);
    const chosen = versions[index];
    if (!chosen) return { ok: false, code: 'invalid_message' } as const;
    const next = [...versions];
    next[index] = answerVersion(last);
    const answer = {
      ...last,
      id: chosen.id,
      parts: chosen.parts,
      metadata: { ...chosen.metadata, versions: next },
    };
    if (!(await replaceLastAnswer(chatId, last, answer)))
      return { ok: false, code: 'busy' } as const;
    return { ok: true, messages: (await getChat(chatId))?.messages ?? [] } as const;
  } finally {
    release();
  }
}
