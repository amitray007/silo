import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { MockLanguageModelV4 } from 'ai/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../model.js', () => ({ languageModelFor: vi.fn() }));
const suite = postgresReachable() ? describe : describe.skip;
const actionId = 'custom:00000000-0000-4000-8000-000000000001';
const ownerAction = { label: 'Find flaws', prompt: 'Find flaws in the attached text.' };

suite('saved actions at the model boundary (real Postgres)', () => {
  let dropDatabase: () => void;
  let core: typeof import('@silo/core');
  let ports: typeof import('@silo/core/ai-credential');
  let runLibrarian: typeof import('./run.js').runLibrarian;
  let languageModelFor: typeof import('../model.js').languageModelFor;
  let linkId: string;
  const toolCall = vi.fn(async () => ({ text: 'Done', isError: false }));
  beforeAll(async () => {
    vi.stubEnv('SILO_SECRET_KEY', Buffer.alloc(32, 7).toString('base64'));
    const database = createDisposableDatabase('silo_worker_actions');
    dropDatabase = database.drop;
    const pool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(pool), pool, '../db/drizzle');
    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    ports = await import('@silo/core/ai-credential');
    ({ runLibrarian } = await import('./run.js'));
    ({ languageModelFor } = await import('../model.js'));
    const { db, aiProviders } = await import('@silo/db');
    await core.saveAiProviderKey('openai', 'fake-key-for-tests');
    await db.update(aiProviders).set({
      models: [
        {
          id: 'test-model',
          label: 'Test model',
          structuredOutput: 'native',
          reasoning: { type: 'openai' },
        },
      ],
    });
    await core.updateSettings({
      ai: {
        enabled: true,
        features: {
          ...core.SETTINGS_DEFAULTS.ai.features,
          librarian: { enabled: true, model: { provider: 'openai', id: 'test-model' } },
        },
      },
    });
    const actions = structuredClone(core.LIBRARIAN_ACTIONS_DEFAULTS);
    actions.passage.push({ id: actionId, ...ownerAction });
    actions.article.push({ id: actionId, ...ownerAction });
    actions.library.push({ id: actionId, ...ownerAction });
    await core.setSetting('librarianActions', actions);
    const link = await core.createLink({
      sourceKind: 'link',
      url: 'https://example.com/action-model',
    });
    linkId = link.id;
    ports.setLibrarianRunner(runLibrarian);
    ports.setLibrarianToolSource({
      list: async () =>
        ['get_link', 'trash_link'].map((name) => ({
          name,
          description: name,
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        })),
      call: toolCall,
    });
  });
  afterAll(async () => {
    ports.setLibrarianRunner(undefined);
    ports.setLibrarianToolSource(undefined);
    const { pool } = await import('@silo/db');
    await pool.end();
    dropDatabase();
    vi.unstubAllEnvs();
  });

  it('resolves a quick passage prompt in system text and exposes only read tools', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const reply = await core.quickLibrarianReply({
      linkId,
      action: actionId,
      quote: 'A passage',
      paragraph: 2,
    });
    expect(reply.ok).toBe(true);
    if (!reply.ok) throw new Error(reply.code);
    expect(reply.response.status).toBe(200);
    await reply.response.text();
    const call = model.doStreamCalls[0];
    const system = call?.prompt
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    expect(system).toContain(`"ownerAction":${JSON.stringify(ownerAction)}`);
    expect(system).toContain('"quote":"A passage"');
    expect(call?.tools?.map((tool) => tool.name)).toEqual(['get_link']);
    expect(call?.prompt).toContainEqual({
      role: 'user',
      content: [{ type: 'text', text: ownerAction.label }],
    });
    expect((await core.listChats()).chats).toEqual([]);
  });

  it.each(['week', 'highlights', actionId])(
    'passes Library action %s to the model',
    async (action) => {
      const model = new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              c.close();
            },
          }),
        }),
      });
      vi.mocked(languageModelFor).mockReturnValue(model);
      const chat = await core.createChat();
      if (!chat) throw new Error('missing library chat');
      const text =
        action === actionId
          ? ownerAction.label
          : action === 'week'
            ? 'Saved this week'
            : 'Recent highlights';
      const reply = await core.streamLibrarianReply({
        chatId: chat.id,
        message: {
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text }],
          metadata: { action },
        },
      });
      expect(reply.ok).toBe(true);
      if (!reply.ok) throw new Error(reply.code);
      await reply.response.text();
      const call = model.doStreamCalls[0];
      const system = call?.prompt
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n');
      expect(system).toContain(`"action":"${action}"`);
      expect(system).toContain('"link":null');
      if (action === actionId)
        expect(system).toContain(`"ownerAction":${JSON.stringify(ownerAction)}`);
      else expect(system).not.toContain('"ownerAction":');
      expect(call?.prompt).toContainEqual({ role: 'user', content: [{ type: 'text', text }] });
    },
  );

  it('replays an old Library related turn to the model when a new Library action runs', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const chat = await core.createChat();
    if (!chat) throw new Error('missing library chat');
    await core.saveChatMessages(chat.id, [
      {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: 'Related' }],
        metadata: { action: 'related' },
      },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [{ type: 'text', text: 'An old answer' }],
      },
    ]);
    const reply = await core.streamLibrarianReply({
      chatId: chat.id,
      message: {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: 'Saved this week' }],
        metadata: { action: 'week' },
      },
    });
    expect(reply.ok).toBe(true);
    if (!reply.ok) throw new Error(reply.code);
    await reply.response.text();
    expect(model.doStreamCalls[0]?.prompt).toEqual(
      expect.arrayContaining([
        { role: 'user', content: [{ type: 'text', text: 'Related' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'An old answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'Saved this week' }] },
      ]),
    );
  });

  it('keeps article writes behind approval and omits a deleted action when resuming history', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({
              type: 'tool-call',
              toolCallId: 'trash',
              toolName: 'trash_link',
              input: JSON.stringify({ id: linkId }),
            });
            c.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            });
            c.close();
          },
        }),
      }),
    });
    vi.mocked(languageModelFor).mockReturnValue(model);
    const chat = await core.createChat({ linkId });
    if (!chat) throw new Error('missing chat');
    const reply = await core.streamLibrarianReply({
      chatId: chat.id,
      message: {
        id: 'article-custom',
        role: 'user',
        parts: [{ type: 'text', text: ownerAction.label }],
        metadata: { action: actionId },
      },
    });
    expect(reply.ok).toBe(true);
    if (!reply.ok) throw new Error(reply.code);
    expect(await reply.response.text()).toContain('tool-approval-request');
    expect(toolCall).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('ownerAction');
    await vi.waitFor(async () =>
      expect((await core.getChat(chat.id))?.messages.at(-1)?.role).toBe('assistant'),
    );
    const saved = await core.getChat(chat.id);
    const assistant = saved?.messages.at(-1);
    if (!assistant) throw new Error('missing approval');
    await core.setSetting('librarianActions', core.LIBRARIAN_ACTIONS_DEFAULTS);
    assistant.parts = assistant.parts.map((part) => {
      if (!part || typeof part !== 'object' || !('approval' in part)) return part;
      return {
        ...part,
        state: 'approval-responded',
        approval: { ...(part.approval as Record<string, unknown>), approved: false },
      };
    });
    const resumedModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
    });
    vi.mocked(languageModelFor).mockReturnValue(resumedModel);
    const resumed = await core.streamLibrarianReply({ chatId: chat.id, message: assistant });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(resumed.code);
    await resumed.response.text();
    const system = resumedModel.doStreamCalls[0]?.prompt
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    expect(system).not.toContain('"ownerAction":');
    expect(system).not.toContain(ownerAction.prompt);
    expect((await core.getChat(chat.id))?.messages[0]?.parts).toEqual([
      { type: 'text', text: ownerAction.label },
    ]);
    const deleted = await core.quickLibrarianReply({
      linkId,
      action: actionId,
      quote: 'A passage',
      paragraph: 1,
    });
    expect(deleted).toEqual({ ok: false, code: 'unknown_action' });
  });
});
