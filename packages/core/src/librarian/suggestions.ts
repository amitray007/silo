import { librarianChats as chats, db, librarianMessages as messages } from '@silo/db';
import { asc, eq } from 'drizzle-orm';
import { isAiFeatureOn } from '../ai/status.js';
import { getSetting } from '../settings/settings.js';
import { getChat } from './index.js';
import { getLibrarianSuggestionsRunner, type Suggestions } from './ports.js';
import { type LibrarianMessage, librarianMessageSchema, suggestionsSchema } from './types.js';

/** The answer is not stored yet: the stream finished before its save. The client asks again. */
export const SUGGESTIONS_NOT_READY = 'not_ready' as const;
type Outcome = Suggestions | null | typeof SUGGESTIONS_NOT_READY;
const pending = new Map<string, Promise<Outcome>>();
function text(message: LibrarianMessage | undefined) {
  return (
    message?.parts
      .flatMap((part) => {
        const p = part as { type?: string; text?: string };
        return p.type === 'text' && typeof p.text === 'string' ? [p.text] : [];
      })
      .join('\n') ?? ''
  );
}
function eligible(message: LibrarianMessage | undefined, id: string) {
  return (
    message?.id === id &&
    message.role === 'assistant' &&
    librarianMessageSchema.parse(message).metadata?.finalAnswer === true &&
    text(message).trim() !== '' &&
    !message.parts.some((part) =>
      ['approval-requested', 'approval-responded', 'input-streaming', 'input-available'].includes(
        (part as { state?: string }).state ?? '',
      ),
    )
  );
}
export async function requestLibrarianSuggestions(
  chatId: string,
  messageId: string,
): Promise<Outcome> {
  if (!(await getSetting('librarianSuggestions')) || !(await isAiFeatureOn('librarian')))
    return null;
  const key = `${chatId}:${messageId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = generate(chatId, messageId);
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}
async function generate(chatId: string, messageId: string): Promise<Outcome> {
  const stored = await getChat(chatId);
  const last = stored?.messages.at(-1);
  // The client heard the stream finish; the answer is saved a moment later.
  if (stored && last?.role === 'user' && !stored.messages.some((m) => m.id === messageId))
    return SUGGESTIONS_NOT_READY;
  if (!eligible(last, messageId) || !last) return null;
  const metadata = librarianMessageSchema.parse(last).metadata;
  if (metadata?.suggestions) return metadata.suggestions;
  const runner = getLibrarianSuggestionsRunner();
  if (!runner) return [];
  const result = await runner(
    text(stored?.messages.findLast((m) => m.role === 'user')),
    text(last),
    metadata?.model,
  );
  // A failed call shows no chips now and may be retried on a later visit.
  if (result === null) return [];
  const items = suggestionsSchema.parse(result);
  return db.transaction(async (tx) => {
    await tx.select().from(chats).where(eq(chats.id, chatId)).for('update');
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.seq));
    const current = rows.at(-1);
    if (
      !eligible(current, messageId) ||
      !current ||
      JSON.stringify(current.parts) !== JSON.stringify(last.parts)
    )
      return null;
    const meta = librarianMessageSchema.parse(current).metadata;
    if (meta?.suggestions) return meta.suggestions;
    await tx
      .update(messages)
      .set({ metadata: { ...meta, suggestions: items } })
      .where(eq(messages.id, messageId));
    return items;
  });
}
