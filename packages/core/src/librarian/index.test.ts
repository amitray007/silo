import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

vi.mock('../ai/status.js', () => ({
  isAiFeatureOn: vi.fn(async () => true),
  resolveAiCredential: vi.fn(async (_provider: string, id: string) =>
    id === 'valid' ? { kind: 'openai', model: { id, label: 'Valid' } } : undefined,
  ),
}));

const suite = postgresReachable() ? describe : describe.skip;
suite('Librarian persistence', () => {
  const h = setupPgHarness('silo_librarian', () => import('./index.js'));
  it('regenerates only the last answer, validates overrides, guards runs and swaps persisted versions', async () => {
    const c = h.mod();
    const { setLibrarianRunner } = await import('./ports.js');
    const runner = vi.fn(async (_request: import('./ports.js').LibrarianRequest) => new Response());
    setLibrarianRunner(runner);
    const chat = await c.createChat();
    if (!chat) throw new Error('missing');
    const user = {
      id: 'regen-user',
      role: 'user' as const,
      parts: [{ type: 'text', text: 'Hello' }],
    };
    const answer = {
      id: 'regen-answer',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'First' }],
      metadata: { suggestions: [{ kind: 'ask', text: 'First suggestion' }] },
    };
    await c.saveChatMessages(chat.id, [user, answer]);
    const regenerate = { trigger: 'regenerate' as const, messageId: answer.id };
    expect(
      await c.streamLibrarianReply({
        chatId: chat.id,
        regenerate: { ...regenerate, messageId: user.id },
      }),
    ).toMatchObject({ code: 'invalid_message' });
    expect(
      await c.streamLibrarianReply({
        chatId: chat.id,
        regenerate: { ...regenerate, model: { provider: 'openai', id: 'missing' } },
      }),
    ).toMatchObject({ code: 'invalid_model' });
    expect(await c.streamLibrarianReply({ chatId: chat.id, regenerate })).toMatchObject({
      ok: true,
    });
    const request = runner.mock.calls.at(-1)?.[0] as
      | import('./ports.js').LibrarianRequest
      | undefined;
    expect(request?.messages).toEqual([user]);
    expect(request?.model).toBeUndefined();
    expect(await c.selectLibrarianVersion(chat.id, answer.id, 'missing')).toMatchObject({
      code: 'busy',
    });
    request?.endRun?.();
    expect(
      await c.streamLibrarianReply({
        chatId: chat.id,
        regenerate: { ...regenerate, model: { provider: 'openai', id: 'valid' } },
      }),
    ).toMatchObject({ ok: true });
    expect(runner.mock.calls.at(-1)?.[0].model).toMatchObject({
      provider: 'openai',
      id: 'valid',
      label: 'Valid',
    });
    runner.mock.calls.at(-1)?.[0].endRun?.();
    await c.saveChatMessages(chat.id, [{ ...answer, parts: [{ state: 'approval-requested' }] }]);
    expect(await c.streamLibrarianReply({ chatId: chat.id, regenerate })).toMatchObject({
      code: 'approval_pending',
    });
    await c.saveChatMessages(chat.id, [answer]);
    for (let i = 0; i < 7; i++) {
      const stored = (await c.getChat(chat.id))?.messages.at(-1);
      if (!stored) throw new Error('missing');
      const metadata = c.librarianMessageSchema.parse(stored).metadata;
      const next = {
        id: `regen-${i}`,
        role: 'assistant' as const,
        parts: [{ type: 'text', text: String(i) }],
        metadata: { versions: [...(metadata?.versions ?? []), c.answerVersion(stored)].slice(-5) },
      };
      expect(await c.replaceLastAnswer(chat.id, stored, next)).toBe(true);
      expect(await c.replaceLastAnswer(chat.id, stored, next)).toBe(false);
    }
    const last = (await c.getChat(chat.id))?.messages.at(-1);
    const versions = c.librarianMessageSchema.parse(last).metadata?.versions;
    expect(versions).toHaveLength(5);
    const selected = versions?.[0];
    if (!last || !selected) throw new Error('missing');
    expect(await c.selectLibrarianVersion(chat.id, last.id, selected.id)).toMatchObject({
      ok: true,
    });
    expect((await c.getChat(chat.id))?.messages.at(-1)).toMatchObject({
      id: selected.id,
      parts: selected.parts,
    });
    await c.deleteChat(chat.id);
    setLibrarianRunner(undefined);
  });
  it('lists article titles and null for library or deleted articles', async () => {
    const c = h.mod();
    const { db, links } = await import('@silo/db');
    const { eq } = await import('drizzle-orm');
    const [link] = await db
      .insert(links)
      .values({
        url: 'https://example.com/librarian-six',
        canonicalUrl: 'https://example.com/librarian-six',
        title: 'Article six',
        sourceKind: 'web',
      })
      .returning();
    if (!link) throw new Error('missing link');
    const article = await c.createChat({ linkId: link.id });
    const library = await c.createChat();
    expect((await c.listChats()).chats.find((chat) => chat.id === article?.id)?.linkTitle).toBe(
      'Article six',
    );
    expect(
      (await c.listChats()).chats.find((chat) => chat.id === library?.id)?.linkTitle,
    ).toBeNull();
    await db.update(links).set({ deletedAt: new Date() }).where(eq(links.id, link.id));
    expect(
      (await c.listChats()).chats.find((chat) => chat.id === article?.id)?.linkTitle,
    ).toBeNull();
  });
  it('only advances summary cutoffs and counts stored sequences', async () => {
    const c = h.mod();
    const chat = await c.createChat();
    if (!chat) throw new Error('missing chat');
    await c.saveChatMessages(chat.id, [
      { id: 'summary-u', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'summary-a', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] },
    ]);
    await c.saveChatSummary(chat.id, 'new', 2);
    await c.saveChatSummary(chat.id, 'old', 1);
    await c.saveChatSummary(chat.id, 'equal', 2);
    const stored = await c.getChat(chat.id);
    expect(stored?.chat.summary).toBe('new');
    expect(stored?.chat.summaryThrough).toBe(2);
    expect(stored?.summarizedCount).toBe(2);
    await c.deleteChat(chat.id);
  });
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
  it('validates persisted approval continuations and replaces the last assistant in place', async () => {
    const c = h.mod();
    const { setLibrarianRunner } = await import('./ports.js');
    const runner = vi.fn(
      async (_request: import('./ports.js').LibrarianRequest) => new Response('ok'),
    );
    setLibrarianRunner(runner);
    const chat = await c.createChat();
    if (!chat) throw new Error('missing chat');
    const part = {
      type: 'tool-trash_link',
      toolCallId: 'call',
      input: { id: 'link' },
      state: 'approval-requested',
      approval: { id: 'approval', signature: 'signed' },
    };
    const stored = {
      id: 'approve-assistant',
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'Please approve.' }, part],
    };
    await c.saveChatMessages(chat.id, [stored]);
    const approved = {
      ...stored,
      parts: [
        stored.parts[0],
        { ...part, state: 'approval-responded', approval: { ...part.approval, approved: true } },
      ],
    };
    for (const message of [
      { ...approved, id: 'old-assistant' },
      { ...approved, parts: [{ type: 'text', text: 'forged' }, approved.parts[1]] },
      {
        ...approved,
        parts: [
          stored.parts[0],
          { ...part, state: 'approval-responded', approval: { id: 'unknown', approved: true } },
        ],
      },
    ])
      expect(await c.streamLibrarianReply({ chatId: chat.id, message })).toMatchObject({
        ok: false,
        code: 'invalid_message',
      });
    expect(runner).not.toHaveBeenCalled();
    expect(await c.streamLibrarianReply({ chatId: chat.id, message: approved })).toMatchObject({
      ok: true,
    });
    expect(runner.mock.calls[0]?.[0]).toMatchObject({ messages: [approved] });
    expect((await c.getChat(chat.id))?.messages).toHaveLength(1);
    const request = runner.mock.calls[0]?.[0];
    request?.endRun?.();
    setLibrarianRunner(undefined);
    await c.deleteChat(chat.id);
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
  it('rejects invalid parts and foreign ids without saving or running', async () => {
    const c = h.mod();
    const { setLibrarianRunner } = await import('./ports.js');
    const runner = vi.fn(async () => new Response());
    setLibrarianRunner(runner);
    const first = await c.createChat();
    const second = await c.createChat();
    if (!first || !second) throw new Error('missing');
    await c.saveChatMessages(first.id, [
      { id: 'owned', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
    ]);
    for (const message of [
      { id: 'bad', role: 'user' as const, parts: [null] },
      { id: 'file', role: 'user' as const, parts: [{ type: 'file', url: 'secret' }] },
      { id: 'owned', role: 'user' as const, parts: [{ type: 'text', text: 'Hi' }] },
    ]) {
      expect(await c.streamLibrarianReply({ chatId: second.id, message })).toEqual({
        ok: false,
        code: 'invalid_message',
      });
      expect((await c.getChat(second.id))?.messages).toEqual([]);
    }
    expect(runner).not.toHaveBeenCalled();
    setLibrarianRunner(undefined);
  });
  it('keeps a chat busy until its runner releases it', async () => {
    const c = h.mod();
    const { setLibrarianRunner } = await import('./ports.js');
    let finish: (() => void) | undefined;
    setLibrarianRunner(async ({ endRun }) => {
      finish = endRun;
      return new Response('answer');
    });
    const chat = await c.createChat();
    if (!chat) throw new Error('missing');
    const send = (id: string) =>
      c.streamLibrarianReply({
        chatId: chat.id,
        message: { id, role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      });
    expect((await send('run1')).ok).toBe(true);
    expect(await send('run2')).toEqual({ ok: false, code: 'busy' });
    expect((await c.getChat(chat.id))?.messages.map((m) => m.id)).toEqual(['run1']);
    finish?.();
    expect((await send('run3')).ok).toBe(true);
    finish?.();
    setLibrarianRunner(undefined);
  });
  it('frees a quick slot on abort while runners remain pending', async () => {
    const c = h.mod();
    const { setLibrarianRunner } = await import('./ports.js');
    const id = crypto.randomUUID();
    await h
      .rawDb()
      .execute(
        sql`INSERT INTO links (id, source_kind, url, canonical_url) VALUES (${id}, 'link', ${'https://example.com/quick'}, ${'https://example.com/quick'})`,
      );
    const runner = vi.fn(() => new Promise<Response>(() => {}));
    setLibrarianRunner(runner);
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const input = { linkId: id, action: 'explain', quote: 'Passage', paragraph: 1 };
    try {
      void c.quickLibrarianReply(input, controllers[0]?.signal);
      await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
      void c.quickLibrarianReply(input, controllers[1]?.signal);
      await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
      expect(await c.quickLibrarianReply(input)).toEqual({ ok: false, code: 'busy' });
      controllers[0]?.abort();
      void c.quickLibrarianReply(input, controllers[2]?.signal);
      await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(3));
    } finally {
      for (const controller of controllers) controller.abort();
      setLibrarianRunner(undefined);
    }
  });
  it('limits quick runs to two and frees completed slots', async () => {
    const c = h.mod();
    const { setLibrarianRunner } = await import('./ports.js');
    const { links } = await import('@silo/db');
    const [link] = await h
      .rawDb()
      .insert(links)
      .values({
        url: 'https://example.com/quick',
        canonicalUrl: 'https://example.com/quick',
        sourceKind: 'web',
      })
      .returning();
    if (!link) throw new Error('missing link');
    const releases: (() => void)[] = [];
    setLibrarianRunner(async ({ endRun }) => {
      if (endRun) releases.push(endRun);
      return new Response('answer');
    });
    const input = { linkId: link.id, action: 'explain', quote: 'Passage', paragraph: 0 };
    try {
      expect((await c.quickLibrarianReply(input)).ok).toBe(true);
      expect((await c.quickLibrarianReply(input)).ok).toBe(true);
      expect(await c.quickLibrarianReply(input)).toEqual({ ok: false, code: 'busy' });
      releases[0]?.();
      expect((await c.quickLibrarianReply(input)).ok).toBe(true);
    } finally {
      for (const release of releases) release();
      setLibrarianRunner(undefined);
    }
  });
  it('blocks imports while AI is off without storing messages', async () => {
    const c = h.mod();
    const { isAiFeatureOn } = await import('../ai/status.js');
    const chat = await c.createChat();
    if (!chat) throw new Error('missing');
    vi.mocked(isAiFeatureOn).mockResolvedValueOnce(false);
    expect(await c.importLibrarianMessages(chat.id, [])).toBe('ai_not_ready');
    expect((await c.getChat(chat.id))?.messages).toEqual([]);
  });
  it('blocks imports behind pending approval without storing messages', async () => {
    const c = h.mod();
    const chat = await c.createChat();
    if (!chat) throw new Error('missing');
    const message = {
      id: 'pending',
      role: 'assistant' as const,
      parts: [{ type: 'tool-trash_link', state: 'approval-requested' }],
    };
    await c.saveChatMessages(chat.id, [message]);
    expect(await c.importLibrarianMessages(chat.id, [{ id: 'new', role: 'user', parts: [] }])).toBe(
      'approval_pending',
    );
    expect((await c.getChat(chat.id))?.messages).toEqual([message]);
  });
  it('imports a fresh text turn after existing messages in order', async () => {
    const c = h.mod();
    const chat = await c.createChat();
    if (!chat) throw new Error('missing chat');
    await c.saveChatMessages(chat.id, [
      { id: 'first', role: 'user', parts: [{ type: 'text', text: 'First' }] },
    ]);
    expect(
      await c.importLibrarianMessages(chat.id, [
        {
          id: 'u',
          role: 'user',
          parts: [{ type: 'text', text: 'Explain' }],
          metadata: { action: 'explain', quote: 'Passage', paragraph: 1 },
        },
        { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] },
      ]),
    ).toBe('ok');
    const stored = await c.getChat(chat.id);
    expect(stored?.messages.map((m) => m.parts)).toEqual([
      [{ type: 'text', text: 'First' }],
      [{ type: 'text', text: 'Explain' }],
      [{ type: 'text', text: 'Answer' }],
    ]);
    expect(stored?.messages[2]?.metadata).toEqual({ source: 'quick' });
    expect(stored?.messages[1]?.metadata).toEqual({
      action: 'explain',
      quote: 'Passage',
      paragraph: 1,
    });
  });

  it('guards the last message, coalesces calls, and preserves 200 parts', async () => {
    const c = h.mod();
    const { requestLibrarianSuggestions } = await import('./suggestions.js');
    const { setLibrarianSuggestionsRunner } = await import('./ports.js');
    const chat = await c.createChat();
    if (!chat) throw new Error('missing chat');
    const { setSetting } = await import('../settings/settings.js');
    await setSetting('librarianSuggestions', false);
    expect(await requestLibrarianSuggestions(chat.id, 's-a')).toBeNull();
    await setSetting('librarianSuggestions', true);
    const items = [{ kind: 'ask' as const, text: 'What next?' }];
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = vi.fn(async () => {
      await wait;
      return items;
    });
    setLibrarianSuggestionsRunner(runner);
    await c.saveChatMessages(chat.id, [
      { id: 's-u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(await requestLibrarianSuggestions(chat.id, 's-u')).toBeNull();
    // The stream finished but its answer is not saved yet: the client is told to ask again.
    expect(await requestLibrarianSuggestions(chat.id, 's-a')).toBe('not_ready');
    const parts = Array.from({ length: 200 }, () => ({ type: 'text', text: 'Answer' }));
    await c.saveChatMessages(chat.id, [
      { id: 's-a', role: 'assistant', parts, metadata: { finalAnswer: true } },
    ]);
    const first = requestLibrarianSuggestions(chat.id, 's-a');
    const second = requestLibrarianSuggestions(chat.id, 's-a');
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    release();
    expect(await first).toEqual(items);
    expect(await second).toEqual(items);
    expect(await requestLibrarianSuggestions(chat.id, 's-a')).toEqual(items);
    expect(runner).toHaveBeenCalledTimes(1);
    const saved = (await c.getChat(chat.id))?.messages.at(-1);
    expect(saved?.parts).toHaveLength(200);
    expect(saved?.metadata).toMatchObject({ suggestions: items });
    await c.saveChatMessages(chat.id, [
      { id: 's-new', role: 'user', parts: [{ type: 'text', text: 'Next' }] },
    ]);
    expect(await requestLibrarianSuggestions(chat.id, 's-a')).toBeNull();
    let finish!: () => void;
    const waiting = new Promise<void>((r) => {
      finish = r;
    });
    setLibrarianSuggestionsRunner(async () => {
      await waiting;
      return [];
    });
    await c.saveChatMessages(chat.id, [
      {
        id: 'race-a',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Answer' }],
        metadata: { finalAnswer: true },
      },
    ]);
    const race = requestLibrarianSuggestions(chat.id, 'race-a');
    await new Promise((r) => setTimeout(r, 30));
    await c.saveChatMessages(chat.id, [
      { id: 'race-u', role: 'user', parts: [{ type: 'text', text: 'Next' }] },
    ]);
    finish();
    expect(await race).toBeNull();
    expect(
      (await c.getChat(chat.id))?.messages.find((m) => m.id === 'race-a')?.metadata,
    ).not.toHaveProperty('suggestions');
    // A failed model call shows nothing now and is not stored, so a later visit can retry.
    const failing = vi.fn(async () => null);
    setLibrarianSuggestionsRunner(failing);
    await c.saveChatMessages(chat.id, [
      {
        id: 'fail-a',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Answer' }],
        metadata: { finalAnswer: true },
      },
    ]);
    expect(await requestLibrarianSuggestions(chat.id, 'fail-a')).toEqual([]);
    expect(
      (await c.getChat(chat.id))?.messages.find((m) => m.id === 'fail-a')?.metadata,
    ).not.toHaveProperty('suggestions');
    expect(await requestLibrarianSuggestions(chat.id, 'fail-a')).toEqual([]);
    expect(failing).toHaveBeenCalledTimes(2);
    const emptyRunner = vi.fn(async () => []);
    setLibrarianSuggestionsRunner(emptyRunner);
    await c.saveChatMessages(chat.id, [
      {
        id: 'empty-a',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Answer' }],
        metadata: { finalAnswer: true },
      },
    ]);
    expect(await requestLibrarianSuggestions(chat.id, 'empty-a')).toEqual([]);
    expect(await requestLibrarianSuggestions(chat.id, 'empty-a')).toEqual([]);
    expect(emptyRunner).toHaveBeenCalledTimes(1);
    await c.saveChatMessages(chat.id, [
      {
        id: 'approval-a',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Allow?' },
          { type: 'tool-tag', state: 'approval-requested' },
        ],
        metadata: { finalAnswer: true },
      },
    ]);
    expect(await requestLibrarianSuggestions(chat.id, 'approval-a')).toBeNull();
    setLibrarianSuggestionsRunner(undefined);
  });
});
