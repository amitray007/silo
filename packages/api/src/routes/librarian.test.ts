vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/postgres';
});

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@silo/core', async (load) => ({
  ...(await load<typeof import('@silo/core')>()),
  streamLibrarianReply: vi.fn(async () => ({ ok: false, code: 'ai_not_ready' })),
}));

import { registerLibrarianRoutes } from './librarian.js';

function app(kind: 'db_token' | 'env_token') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('authKind', kind);
    await next();
  });
  registerLibrarianRoutes(app);
  return app;
}
describe('Librarian route access', () => {
  it('rejects named tokens on every route', async () => {
    const api = app('db_token');
    for (const [method, path] of [
      ['GET', '/librarian/chats'],
      ['POST', '/librarian/chats'],
      ['GET', '/librarian/chats/id'],
      ['DELETE', '/librarian/chats/id'],
      ['POST', '/librarian/chats/id/messages'],
    ] as const) {
      expect((await api.request(path ?? '', { method })).status).toBe(403);
    }
  });
  it('passes an assistant approval envelope through to core validation', async () => {
    const { streamLibrarianReply } = await import('@silo/core');
    const message = {
      id: 'assistant',
      role: 'assistant',
      parts: [
        {
          type: 'tool-trash_link',
          state: 'approval-responded',
          input: { id: 'link' },
          toolCallId: 'call',
          approval: { id: 'approval', approved: false },
        },
      ],
    };
    const response = await app('env_token').request(
      '/librarian/chats/00000000-0000-4000-8000-000000000001/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      },
    );
    expect(response.status).toBe(409);
    expect(streamLibrarianReply).toHaveBeenCalledWith({
      chatId: '00000000-0000-4000-8000-000000000001',
      message,
    });
  });
  it('returns 409 when the feature is off', async () => {
    const response = await app('env_token').request(
      '/librarian/chats/00000000-0000-4000-8000-000000000001/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'ai_not_ready' });
  });
});

it.each([[null], [{ type: 'file', url: 'https://example.com', mediaType: 'text/plain' }]])(
  'rejects invalid parts before running',
  async (...[parts]) => {
    const { streamLibrarianReply } = await import('@silo/core');
    vi.mocked(streamLibrarianReply).mockClear();
    const response = await app('env_token').request(
      '/librarian/chats/00000000-0000-4000-8000-000000000001/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: { id: 'bad', role: 'user', parts: [parts] } }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_message' });
    expect(streamLibrarianReply).not.toHaveBeenCalled();
  },
);

it('maps an active run to HTTP 409 busy', async () => {
  const { streamLibrarianReply } = await import('@silo/core');
  vi.mocked(streamLibrarianReply).mockResolvedValueOnce({ ok: false, code: 'busy' });
  const response = await app('env_token').request(
    '/librarian/chats/00000000-0000-4000-8000-000000000001/messages',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
      }),
    },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'busy' });
});
