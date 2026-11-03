import type { LibrarianActions, LibrarianMessage } from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const suite = postgresReachable() ? describe : describe.skip;
const passageId = 'custom:00000000-0000-4000-8000-000000000001';
const articleId = 'custom:00000000-0000-4000-8000-000000000002';
const passage = {
  id: passageId,
  label: 'Check logic',
  prompt: 'Check this passage for logical errors.',
};
const article = { id: articleId, label: 'Read critically', prompt: 'Check the article claims.' };
const libraryId = 'custom:00000000-0000-4000-8000-000000000003';
const library = {
  id: libraryId,
  label: 'Find connections',
  prompt: 'Find themes across the library.',
};
const user = (action: string, quote?: string): LibrarianMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  parts: [{ type: 'text', text: 'Check logic' }],
  metadata: { action, ...(quote === undefined ? {} : { quote, paragraph: 1 }) },
});

suite('custom actions over HTTP and real Postgres', () => {
  const h = setupPgHarness('silo_api_actions', async () => {
    vi.stubEnv('SILO_SECRET_KEY', Buffer.alloc(32, 7).toString('base64'));
    const core = await import('@silo/core');
    const ports = await import('@silo/core/ai-credential');
    const db = await import('@silo/db');
    const { createApp } = await import('../app.js');
    return { core, ports, db, app: createApp() };
  });
  afterAll(() => vi.unstubAllEnvs());
  let linkId: string;
  let chatId: string;
  let actions: LibrarianActions;
  const requests: import('@silo/core/ai-credential').LibrarianRequest[] = [];
  const request = async (path: string, body?: unknown, method = 'POST') =>
    h.mod().app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const save = (value: unknown) => request('/settings', { librarianActions: value }, 'PATCH');
  beforeEach(async () => {
    const { core, db, ports } = h.mod();
    await db.db.execute(sql`TRUNCATE settings, ai_providers, links, librarian_chats CASCADE`);
    // A provider with a stored model is sufficient for readiness; no network call is made.
    await core.saveAiProviderKey('openai', 'test-key');
    await db.db.execute(
      sql`UPDATE ai_providers SET models = '[{"id":"gpt-test","label":"Test","structuredOutput":"native","reasoning":{"type":"openai"}}]'::jsonb WHERE kind = 'openai'`,
    );
    await core.updateSettings({
      ai: {
        enabled: true,
        features: {
          librarian: { enabled: true, model: { provider: 'openai', id: 'gpt-test' } },
          'x-post-title': { enabled: false, model: null },
        },
      },
    });
    const link = await core.createLink({
      url: 'https://example.com/custom-actions',
      sourceKind: 'link',
    });
    linkId = link.id;
    const chat = await core.createChat({ linkId });
    if (!chat) throw new Error('missing chat');
    chatId = chat.id;
    actions = structuredClone(core.LIBRARIAN_ACTIONS_DEFAULTS);
    requests.length = 0;
    ports.setLibrarianRunner(async (input) => {
      requests.push(input);
      input.endRun?.();
      return new Response('answer');
    });
  });
  const quick = (action = passageId) =>
    request('/librarian/quick', { linkId, action, quote: 'A passage', paragraph: 1 });
  const imported = (action = passageId) =>
    request(`/librarian/chats/${chatId}/import`, {
      messages: [
        user(action, 'A passage'),
        { id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] },
      ],
    });

  it('returns defaults, saves trimmed actions, and retains list order and hidden flags', async () => {
    const before = await request('/settings', undefined, 'GET');
    expect(before.status).toBe(200);
    expect(((await before.json()) as { librarianActions: unknown }).librarianActions).toEqual(
      actions,
    );
    actions.library.reverse();
    actions.library[0] = { id: 'highlights', hidden: true };
    actions.library.push(library);
    actions.passage.reverse();
    actions.passage[0] = { id: 'related', hidden: true };
    actions.article.push({
      ...article,
      label: ' Read critically ',
      prompt: ' Check the article claims. ',
    });
    expect((await save(actions)).status).toBe(200);
    const read = await request('/settings', undefined, 'GET');
    expect(((await read.json()) as { librarianActions: unknown }).librarianActions).toEqual({
      ...actions,
      article: [...actions.article.slice(0, -1), article],
    });
    const legacy = {
      ...actions,
      passage: actions.passage.filter((entry) => entry.id !== 'explain'),
    };
    await h
      .mod()
      .db.db.execute(
        sql`UPDATE settings SET value = ${JSON.stringify(legacy)}::jsonb WHERE key = 'librarianActions'`,
      );
    const upgraded = await request('/settings', undefined, 'GET');
    expect(upgraded.status).toBe(200);
    expect(
      (
        (await upgraded.json()) as { librarianActions: LibrarianActions }
      ).librarianActions.passage.at(-1),
    ).toEqual({ id: 'explain', hidden: false });
  });

  it('accepts six custom actions per hidden list and exact text bounds over HTTP', async () => {
    for (const list of [actions.passage, actions.article, actions.library]) {
      for (const entry of list) if ('hidden' in entry) entry.hidden = true;
      list.push(
        ...Array.from({ length: 6 }, (_, n) => ({
          id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          label: n === 0 ? 'x' : 'x'.repeat(24),
          prompt: n === 0 ? 'x' : 'x'.repeat(1000),
        })),
      );
    }
    expect((await save(actions)).status).toBe(200);
    expect(await h.mod().core.getSetting('librarianActions')).toEqual(actions);
  });

  const rejections: [string, (value: LibrarianActions) => unknown][] = [
    ['unknown top-level key', (v) => ({ ...v, other: [] })],
    [
      'unknown entry field',
      (v) => ({ ...v, passage: [...v.passage, { ...passage, other: true }] }),
    ],
    [
      'unknown built-in',
      (v) => ({ ...v, passage: [...v.passage, { id: 'bogus', hidden: false }] }),
    ],
    [
      'wrong-list built-in',
      (v) => ({ ...v, article: [...v.article, { id: 'explain', hidden: false }] }),
    ],
    [
      'renamed built-in',
      (v) => ({
        ...v,
        article: [{ id: 'summary', hidden: false, label: 'New name' }, ...v.article.slice(1)],
      }),
    ],
    ['missing built-in', (v) => ({ ...v, passage: v.passage.slice(1) })],
    ['duplicate built-in', (v) => ({ ...v, article: [...v.article, v.article[0]] })],
    ['duplicate custom', (v) => ({ ...v, passage: [...v.passage, passage, passage] })],
    ['invalid uuid', (v) => ({ ...v, passage: [...v.passage, { ...passage, id: 'custom:bad' }] })],
    [
      'invalid custom prefix',
      (v) => ({
        ...v,
        passage: [...v.passage, { ...passage, id: '00000000-0000-4000-8000-000000000001' }],
      }),
    ],
    [
      'empty label after trim',
      (v) => ({ ...v, passage: [...v.passage, { ...passage, label: '  ' }] }),
    ],
    [
      'label over 24',
      (v) => ({ ...v, passage: [...v.passage, { ...passage, label: 'x'.repeat(25) }] }),
    ],
    [
      'empty prompt after trim',
      (v) => ({ ...v, passage: [...v.passage, { ...passage, prompt: '  ' }] }),
    ],
    [
      'prompt over 1000',
      (v) => ({ ...v, passage: [...v.passage, { ...passage, prompt: 'x'.repeat(1001) }] }),
    ],
    ['missing hidden', (v) => ({ ...v, article: [{ id: 'summary' }, ...v.article.slice(1)] })],
    [
      'nonboolean hidden',
      (v) => ({ ...v, article: [{ id: 'summary', hidden: 'yes' }, ...v.article.slice(1)] }),
    ],
    [
      'over six custom actions',
      (v) => ({
        ...v,
        passage: [
          ...v.passage.map((e) => ({ ...e, hidden: true })),
          ...Array.from({ length: 7 }, (_, n) => ({
            ...passage,
            id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          })),
        ],
      }),
    ],
    [
      'over six phrase chips',
      (v) => ({
        ...v,
        passage: [
          ...v.passage.map((e) => ({
            ...e,
            hidden: ['define', 'context', 'related'].includes(e.id),
          })),
          ...Array.from({ length: 4 }, (_, n) => ({
            ...passage,
            id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          })),
        ],
      }),
    ],
    [
      'over six word chips',
      (v) => ({
        ...v,
        passage: [
          ...v.passage.map((e) => ({
            ...e,
            hidden: ['explain', 'simplify', 'counterpoint'].includes(e.id),
          })),
          ...Array.from({ length: 4 }, (_, n) => ({
            ...passage,
            id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          })),
        ],
      }),
    ],
    [
      'over six article chips',
      (v) => ({
        ...v,
        article: [
          ...v.article,
          ...Array.from({ length: 3 }, (_, n) => ({
            ...article,
            id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          })),
        ],
      }),
    ],
  ];
  const libraryRejections: [string, (value: LibrarianActions) => unknown][] = [
    ['missing Library list', (v) => ({ passage: v.passage, article: v.article })],
    ['missing Library built-in', (v) => ({ ...v, library: v.library.slice(1) })],
    [
      'unknown Library built-in',
      (v) => ({ ...v, library: [...v.library, { id: 'bogus', hidden: false }] }),
    ],
    [
      'wrong-kind Library built-in',
      (v) => ({ ...v, library: [...v.library, { id: 'related', hidden: false }] }),
    ],
    [
      'renamed Library built-in',
      (v) => ({
        ...v,
        library: [{ id: 'week', hidden: false, label: 'Renamed' }, ...v.library.slice(1)],
      }),
    ],
    ['duplicate Library built-in', (v) => ({ ...v, library: [...v.library, v.library[0]] })],
    ['duplicate Library custom', (v) => ({ ...v, library: [...v.library, library, library] })],
    [
      'missing Library hidden flag',
      (v) => ({ ...v, library: [{ id: 'week' }, ...v.library.slice(1)] }),
    ],
    [
      'nonboolean Library hidden flag',
      (v) => ({ ...v, library: [{ id: 'week', hidden: 'yes' }, ...v.library.slice(1)] }),
    ],
    [
      'invalid Library custom id',
      (v) => ({ ...v, library: [...v.library, { ...library, id: 'custom:bad' }] }),
    ],
    ['empty Library label', (v) => ({ ...v, library: [...v.library, { ...library, label: ' ' }] })],
    [
      'Library label over 24',
      (v) => ({ ...v, library: [...v.library, { ...library, label: 'x'.repeat(25) }] }),
    ],
    [
      'empty Library prompt',
      (v) => ({ ...v, library: [...v.library, { ...library, prompt: ' ' }] }),
    ],
    [
      'Library prompt over 1000',
      (v) => ({ ...v, library: [...v.library, { ...library, prompt: 'x'.repeat(1001) }] }),
    ],
    [
      'unknown Library custom field',
      (v) => ({ ...v, library: [...v.library, { ...library, other: true }] }),
    ],
    [
      'over six Library customs',
      (v) => ({
        ...v,
        library: [
          ...v.library.map((entry) => ({ ...entry, hidden: true })),
          ...Array.from({ length: 7 }, (_, n) => ({
            ...library,
            id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          })),
        ],
      }),
    ],
    [
      'over six Library chips',
      (v) => ({
        ...v,
        library: [
          ...v.library,
          ...Array.from({ length: 5 }, (_, n) => ({
            ...library,
            id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          })),
        ],
      }),
    ],
  ];
  it.each([...rejections, ...libraryRejections])(
    'rejects %s with 400 and preserves storage',
    async (_name, change) => {
      expect((await save(change(actions))).status).toBe(400);
      expect(await h.mod().core.getSetting('librarianActions')).toEqual(actions);
    },
  );

  it('runs passage and article actions and imports a custom passage turn', async () => {
    actions.passage.push(passage);
    actions.article.push(article);
    expect((await save(actions)).status).toBe(200);
    expect((await quick()).status).toBe(200);
    expect(requests[0]).toMatchObject({
      transient: true,
      ownerAction: { label: passage.label, prompt: passage.prompt },
      messages: [{ parts: [{ type: 'text', text: passage.label }] }],
    });
    expect(
      (
        await request(`/librarian/chats/${chatId}/messages`, {
          message: user(passageId, 'A passage'),
        })
      ).status,
    ).toBe(200);
    expect(requests.at(-1)?.ownerAction).toEqual({ label: passage.label, prompt: passage.prompt });
    expect((await imported()).status).toBe(204);
    expect((await h.mod().core.getChat(chatId))?.messages[0]?.metadata).toMatchObject({
      action: passageId,
    });
    expect(
      (await request(`/librarian/chats/${chatId}/messages`, { message: user(articleId) })).status,
    ).toBe(200);
    expect(requests.at(-1)).toMatchObject({
      ownerAction: { label: article.label, prompt: article.prompt },
    });
    expect(requests.at(-1)?.transient).toBeUndefined();
  });
  it('rejects deleted and wrong-kind ids without storing new turns', async () => {
    actions.article.push(article);
    actions.passage.push(passage);
    expect((await save(actions)).status).toBe(200);
    actions.passage.pop();
    expect((await save(actions)).status).toBe(200);
    for (const response of [
      await quick(),
      await quick(articleId),
      await imported(),
      await imported(articleId),
      await request(`/librarian/chats/${chatId}/messages`, { message: user(passageId) }),
      await request(`/librarian/chats/${chatId}/messages`, { message: user(articleId, 'Quote') }),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'unknown_action' });
    }
    expect((await h.mod().core.getChat(chatId))?.messages).toEqual([]);
    expect(requests).toEqual([]);
  });
  it('runs Library built-ins and custom actions using the chat kind', async () => {
    actions.library.push(library);
    actions.passage.push(passage);
    expect((await save(actions)).status).toBe(200);
    const chat = await h.mod().core.createChat();
    if (!chat) throw new Error('missing library chat');
    for (const action of ['week', 'highlights', libraryId]) {
      expect(
        (await request(`/librarian/chats/${chat.id}/messages`, { message: user(action) })).status,
      ).toBe(200);
      expect(requests.at(-1)).toMatchObject({
        link: null,
        messages: expect.arrayContaining([expect.objectContaining({ metadata: { action } })]),
      });
    }
    expect(requests.at(-1)?.ownerAction).toEqual({ label: library.label, prompt: library.prompt });
    expect(
      (await request(`/librarian/chats/${chat.id}/messages`, { message: user(passageId, 'Quote') }))
        .status,
    ).toBe(200);
    expect(requests.at(-1)?.ownerAction).toEqual({ label: passage.label, prompt: passage.prompt });
  });

  it('rejects wrong-kind built-ins and Library customs before storing new turns', async () => {
    actions.library.push(library);
    actions.article.push(article);
    expect((await save(actions)).status).toBe(200);
    const chat = await h.mod().core.createChat();
    if (!chat) throw new Error('missing library chat');
    for (const response of [
      await request(`/librarian/chats/${chatId}/messages`, { message: user('week') }),
      await request(`/librarian/chats/${chatId}/messages`, { message: user('highlights') }),
      await request(`/librarian/chats/${chatId}/messages`, { message: user(libraryId) }),
      await request(`/librarian/chats/${chatId}/messages`, { message: user('explain') }),
      await request(`/librarian/chats/${chatId}/messages`, { message: user('summary', 'Quote') }),
      await request(`/librarian/chats/${chat.id}/messages`, { message: user('related') }),
      await request(`/librarian/chats/${chat.id}/messages`, { message: user('summary') }),
      await request(`/librarian/chats/${chat.id}/messages`, { message: user(articleId) }),
      await request(`/librarian/chats/${chat.id}/messages`, { message: user('week', 'Quote') }),
      await request(`/librarian/chats/${chat.id}/messages`, { message: user(libraryId, 'Quote') }),
      await quick('week'),
      await quick('summary'),
      await quick(libraryId),
      await imported('week'),
      await imported('summary'),
      await imported(libraryId),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'unknown_action' });
    }
    expect((await h.mod().core.getChat(chatId))?.messages).toEqual([]);
    expect((await h.mod().core.getChat(chat.id))?.messages).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('loads and replays an old Library related turn, including an approval continuation', async () => {
    const { core } = h.mod();
    const chat = await core.createChat();
    if (!chat) throw new Error('missing library chat');
    const oldUser = user('related');
    const approval = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      parts: [
        { type: 'tool-trash_link', state: 'approval-requested', approval: { id: 'approval' } },
      ],
    };
    await core.saveChatMessages(chat.id, [oldUser, approval]);
    const loaded = await request(`/librarian/chats/${chat.id}`, undefined, 'GET');
    expect(loaded.status).toBe(200);
    expect(((await loaded.json()) as { messages: unknown[] }).messages).toEqual([
      oldUser,
      approval,
    ]);
    expect(
      (
        await request(`/librarian/chats/${chat.id}/messages`, {
          message: {
            ...approval,
            parts: [
              {
                ...approval.parts[0],
                state: 'approval-responded',
                approval: { id: 'approval', approved: false },
              },
            ],
          },
        })
      ).status,
    ).toBe(200);
    expect(requests.at(-1)?.messages[0]).toEqual(oldUser);
    expect(
      (await request(`/librarian/chats/${chat.id}/messages`, { message: user('week') })).status,
    ).toBe(200);
    expect(requests.at(-1)?.messages[0]).toEqual(oldUser);
  });

  it('keeps quick capacity ahead of unknown action and releases both slots', async () => {
    const releases: (() => void)[] = [];
    h.mod().ports.setLibrarianRunner(async (input) => {
      if (input.endRun) releases.push(input.endRun);
      return new Response('answer');
    });
    try {
      expect((await quick('explain')).status).toBe(200);
      expect((await quick('define')).status).toBe(200);
      const response = await quick();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'busy' });
    } finally {
      for (const release of releases) release();
    }
  });

  it('keeps readiness, busy and pending approval ahead of unknown action', async () => {
    const { core, ports } = h.mod();
    await core.setSetting('ai', { ...core.SETTINGS_DEFAULTS.ai, enabled: false });
    for (const response of [
      await quick(),
      await imported(),
      await request(`/librarian/chats/${chatId}/messages`, { message: user(articleId) }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'ai_not_ready' });
    }
    await core.setSetting('ai', {
      enabled: true,
      features: {
        ...core.SETTINGS_DEFAULTS.ai.features,
        librarian: { enabled: true, model: { provider: 'openai', id: 'gpt-test' } },
      },
    });
    let release: (() => void) | undefined;
    ports.setLibrarianRunner(async (input) => {
      release = input.endRun;
      return new Response('answer');
    });
    expect(
      (
        await request(`/librarian/chats/${chatId}/messages`, {
          message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
        })
      ).status,
    ).toBe(200);
    for (const response of [
      await imported(),
      await request(`/librarian/chats/${chatId}/messages`, { message: user(articleId) }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'busy' });
    }
    release?.();
    await core.saveChatMessages(chatId, [
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [{ type: 'tool-trash_link', state: 'approval-requested' }],
      },
    ]);
    const pending = await imported();
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ error: 'approval_pending' });
  });
});
