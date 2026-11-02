import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const suite = postgresReachable() ? describe : describe.skip;
suite('Librarian persistence', () => {
  const h = setupPgHarness('silo_librarian', () => import('./index.js'));
  it('creates, saves, replaces in place, titles and deletes', async () => {
    const c = h.mod();
    const chat = await c.createChat();
    if (!chat) throw new Error('missing chat');
    await c.saveChatMessages(chat.id, [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '  Hello library  ' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'first' }] },
    ]);
    await c.saveChatMessages(chat.id, [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'replacement' }] },
    ]);
    const result = await c.getChat(chat.id);
    expect(result?.chat.title).toBe('Hello library');
    expect(result?.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(result?.messages[1]?.parts).toEqual([{ type: 'text', text: 'replacement' }]);
    await c.deleteChat(chat.id);
    expect(await c.getChat(chat.id)).toBeNull();
  });
  it('pages tied timestamps without losing chats and rejects invalid links', async () => {
    const c = h.mod();
    const chats = [await c.createChat(), await c.createChat(), await c.createChat()];
    await h
      .rawDb()
      .execute(sql`UPDATE librarian_chats SET updated_at = '2026-11-02 12:00:00.123456+00'`);
    const first = await c.listChats({ limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    const second = await c.listChats({ limit: 1, cursor: first.nextCursor ?? undefined });
    const third = await c.listChats({ limit: 1, cursor: second.nextCursor ?? undefined });
    expect([first, second, third].flatMap((page) => page.chats.map((chat) => chat.id))).toEqual(
      chats.map((chat) => chat?.id).sort(),
    );
    expect(third.nextCursor).toBeNull();
    expect(await c.createChat({ linkId: '00000000-0000-4000-8000-000000000001' })).toBeNull();
    for (const chat of chats) if (chat) await c.deleteChat(chat.id);
  });
  it('titles quick actions from the quote and keeps the first title', async () => {
    const c = h.mod();
    const chat = await c.createChat();
    if (!chat) throw new Error('missing');
    await c.saveChatMessages(chat.id, [
      {
        id: 'quick',
        role: 'user',
        parts: [],
        metadata: { action: 'explain', quote: 'x'.repeat(100) },
      },
    ]);
    await c.saveChatMessages(chat.id, [
      { id: 'later', role: 'user', parts: [{ type: 'text', text: 'Different title' }] },
    ]);
    expect((await c.getChat(chat.id))?.chat.title).toBe('x'.repeat(60));
    await c.deleteChat(chat.id);
  });
});
