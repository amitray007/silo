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
            active('retired', { deprecationDate: '2000-01-01T00:00:00Z' }),
            active('invalid-date', { deprecationDate: 'not a date' }),
          ],
          'next token+/=',
        ),
      )
      .mockResolvedValueOnce(
        page([
          active('accounts/fireworks/models/glm-5p3-flash', {
            deprecationDate: '2999-01-01T00:00:00Z',
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
