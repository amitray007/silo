import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFireworksModelsFetcher } from './fireworks-models.js';

const KEY = 'fake-fireworks-key-1234';
const active = (name: string, extra = {}) => ({
  name,
  conversationConfig: {},
  supportsServerless: true,
  state: 'READY',
  contextLength: 200000,
  ...extra,
});
const page = (models: unknown[], nextPageToken = '') =>
  Response.json({ models, nextPageToken, totalSize: 10 });
afterEach(() => vi.restoreAllMocks());

describe('Fireworks live model list', () => {
  it('pages at the fixed URL with bearer auth, filters locally, and stores only public model fields', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        page(
          [
            active('accounts/fireworks/models/first', { displayName: 'First model', extra: KEY }),
            active('no-chat', { conversationConfig: null }),
            active('dedicated', { supportsServerless: false }),
            active('loading', { state: 'CREATING' }),
            active('retired', { deprecationDate: { year: 2000, month: 1, day: 1 } }),
            active('invalid-date', { deprecationDate: 'not a date' }),
          ],
          'next token+/=',
        ),
      )
      .mockResolvedValueOnce(
        page([
          active('accounts/fireworks/models/glm-5p3-flash', {
            deprecationDate: { year: 2999, month: 1, day: 1 },
          }),
          active('accounts/fireworks/models/unknown-context', { contextLength: undefined }),
        ]),
      );
    const result = await createFireworksModelsFetcher(fetch)(KEY);
    expect(result).toEqual({
      ok: true,
      models: [
        { id: 'accounts/fireworks/models/first', label: 'First model', contextLength: 200000 },
        {
          id: 'accounts/fireworks/models/glm-5p3-flash',
          label: 'glm-5p3-flash',
          contextLength: 200000,
        },
        {
          id: 'accounts/fireworks/models/unknown-context',
          label: 'unknown-context',
          contextLength: null,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(first.origin + first.pathname).toBe(
      'https://api.fireworks.ai/v1/accounts/fireworks/models',
    );
    expect(first.searchParams.get('pageSize')).toBe('200');
    expect(first.searchParams.has('pageToken')).toBe(false);
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('pageToken')).toBe(
      'next token+/=',
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: `Bearer ${KEY}` },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(fetch.mock.calls[1]?.[1]?.signal);
  });

  it('excludes the live embedding and reranker shapes even though they have chat configs', async () => {
    // Public fields from the Fireworks API on 2026-10-29. Templates and unrelated metadata omitted.
    const live = [
      {
        name: 'accounts/fireworks/models/qwen3-embedding-8b',
        displayName: 'Qwen3 Embedding 8B',
        kind: 'EMBEDDING_MODEL',
        baseModelDetails: { modelType: 'qwen3' },
        conversationConfig: { style: 'jinja', system: '' },
        supportsServerless: true,
        state: 'READY',
        contextLength: 40960,
      },
      {
        name: 'accounts/fireworks/models/qwen3-reranker-8b',
        displayName: 'Qwen3 Reranker 8B',
        kind: 'EMBEDDING_MODEL',
        baseModelDetails: { modelType: 'qwen3' },
        conversationConfig: { style: 'jinja', system: '' },
        supportsServerless: true,
        state: 'READY',
        contextLength: 40960,
      },
      {
        name: 'accounts/fireworks/models/glm-5p3-flash',
        displayName: 'GLM 5.3 Flash',
        kind: 'HF_BASE_MODEL',
        baseModelDetails: { modelType: 'glm5_next_text' },
        conversationConfig: { style: '', system: '', template: '' },
        supportsServerless: true,
        state: 'READY',
        contextLength: 1048576,
      },
    ];
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(page(live));
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({
      ok: true,
      models: [
        {
          id: 'accounts/fireworks/models/glm-5p3-flash',
          label: 'GLM 5.3 Flash',
          contextLength: 1048576,
        },
      ],
    });
  });

  it('uses kind independently of name and falls back to embedding or rerank names', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        page([
          active('semantic-vectors', { kind: 'EMBEDDING_MODEL' }),
          active('Qwen3-EMBEDDING-8b'),
          active('qwen3-reranker-8b', { kind: 'HF_BASE_MODEL' }),
          active('new-rerank-model'),
          active('chat-model-without-kind'),
          active('chat-model-with-kind', { kind: 'HF_BASE_MODEL' }),
        ]),
      );
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({
      ok: true,
      models: ['chat-model-without-kind', 'chat-model-with-kind'].map((id) => ({
        id,
        label: id,
        contextLength: 200000,
      })),
    });
  });

  it('accepts ISO dates and skips individual malformed models without losing usable entries', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        page([
          active('future-iso', { deprecationDate: '2999-01-01T00:00:00Z' }),
          active('future-date', { deprecationDate: '2999-01-01' }),
          active('no-date', { deprecationDate: null }),
          active('retired-iso', { deprecationDate: '2000-01-01T00:00:00Z' }),
          active('impossible-date', { deprecationDate: { year: 2999, month: 2, day: 30 } }),
          active('missing-day', { deprecationDate: { year: 2999, month: 1 } }),
          active('invalid-month', { deprecationDate: { year: 2999, month: 13, day: 1 } }),
          active('bad-context', { contextLength: 'unknown' }),
          active('bad-name', { name: null }),
          null,
          'garbage',
        ]),
      );
    const result = await createFireworksModelsFetcher(fetch)(KEY);
    expect(result).toEqual({
      ok: true,
      models: ['future-iso', 'future-date', 'no-date'].map((id) => ({
        id,
        label: id,
        contextLength: 200000,
      })),
    });
  });

  it('accepts a page at the byte limit', async () => {
    const body = JSON.stringify({ models: [active('one')] }).padEnd(2 * 1024 * 1024, ' ');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({
      ok: true,
      models: [{ id: 'one', label: 'one', contextLength: 200000 }],
    });
  });

  it('aborts and cancels a streamed page over the byte limit without a content-length header', async () => {
    const cancel = vi.fn();
    const chunk = new TextEncoder().encode('é'.repeat(512 * 1024));
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel,
      }),
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({
      ok: false,
      code: 'provider_error',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([500, 501])('bounds unique models across pages at 500 (%s entries)', async (count) => {
    const entries = Array.from({ length: count }, (_, i) => active(`model-${i}`));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page(entries.slice(0, 200), 'two'))
      .mockResolvedValueOnce(page(entries.slice(200, 400), 'three'))
      .mockResolvedValueOnce(page([...entries.slice(400), active('model-0')]));
    const result = await createFireworksModelsFetcher(fetch)(KEY);
    if (count === 500) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.models).toHaveLength(500);
    } else {
      expect(result).toEqual({ ok: false, code: 'provider_error' });
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    }
  });

  it('caps id and label lengths and skips oversized entries', async () => {
    const id = 'i'.repeat(512);
    const label = 'l'.repeat(256);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        page([
          active(id, { displayName: label }),
          active(`${id}x`),
          active('oversized-label', { displayName: `${label}x` }),
          active('f'.repeat(512)),
        ]),
      );
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({
      ok: true,
      models: [
        { id, label, contextLength: 200000 },
        { id: 'f'.repeat(512), label: 'f'.repeat(256), contextLength: 200000 },
      ],
    });
  });

  it.each([
    [401, 'invalid_key'],
    [402, 'quota'],
    [403, 'no_access'],
    [412, 'no_access'],
    [404, 'model_not_found'],
    [429, 'rate_limited'],
  ] as const)('maps HTTP %s to %s without parsing its body', async (status, code) => {
    const response = new Response(KEY, { status });
    const json = vi.spyOn(response, 'json');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({ ok: false, code });
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caps at ten pages and refuses a partial list', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => page([active('one')], 'more'));
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({
      ok: false,
      code: 'provider_error',
    });
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('uses a 10 second deadline and maps timeout or network failure without exposing errors', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new DOMException(KEY, 'TimeoutError'));
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({ ok: false, code: 'timeout' });
    expect(timeout).toHaveBeenCalledWith(10000);
    fetch.mockRejectedValue(new TypeError('fetch failed'));
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({ ok: false, code: 'network' });
  });

  it('rejects malformed pages without logging their body and makes no call for an empty key', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ models: KEY }));
    expect(await createFireworksModelsFetcher(fetch)(KEY)).toEqual({
      ok: false,
      code: 'provider_error',
    });
    expect(await createFireworksModelsFetcher(fetch)('')).toEqual({
      ok: false,
      code: 'invalid_key',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
