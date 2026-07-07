import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, ClientError } from './client.js';
import type { CaptureResponse, LinkJson } from './types.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const linkFixture: LinkJson = {
  id: '11111111-1111-1111-1111-111111111111',
  url: 'https://example.com/post',
  title: 'A post',
  description: null,
  imageUrl: null,
  siteName: 'example.com',
  extractedText: null,
  sourceKind: 'link',
  sourceData: { kind: 'link' },
  captureStatus: 'full',
  addedBy: 'user',
  notes: null,
  tags: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('Client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves requests against the configured base url', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }, 200));

    const client = new Client({ baseUrl: 'http://example.test:9000', token: undefined });
    await client.health();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test:9000/health',
      expect.objectContaining({ headers: {} }),
    );
  });

  it('sends Authorization: Bearer when a token is configured', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ link: linkFixture, deduped: false }, 201));

    const client = new Client({ baseUrl: 'http://localhost:8787', token: 'secret-token' });
    await client.ingest({ url: 'https://x.com/a/status/1', sourceKind: 'twitter' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/ingest',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      }),
    );
  });

  it('does not send an Authorization header when no token is configured', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ link: linkFixture, deduped: false }, 201));

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });
    await client.capture({ url: 'https://example.com' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns the typed capture response on a 201', async () => {
    const body: CaptureResponse = { link: linkFixture, deduped: false };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body, 201));

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });
    const result = await client.capture({ url: 'https://example.com' });

    expect(result).toEqual(body);
  });

  it('throws a network_error ClientError with an actionable hint when the API is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });

    await expect(client.health()).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      hint: expect.stringContaining('Is silo running?'),
    });
  });

  it('maps a 401 to a ClientError with an ingest-token hint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: 'unauthorized', message: 'A valid Authorization: Bearer token is required.' },
        401,
      ),
    );

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });

    await expect(client.ingest({ url: 'https://x.com/a/status/1' })).rejects.toMatchObject({
      status: 401,
      hint: expect.stringContaining('SILO_API_TOKEN'),
    });
  });

  it('maps a 400 to a ClientError carrying the server message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: 'invalid_url', message: 'Not a valid http(s) URL; nothing was saved.' },
        400,
      ),
    );

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });

    await expect(client.capture({ url: 'not-a-url' })).rejects.toThrow(
      'Not a valid http(s) URL; nothing was saved.',
    );
  });

  it('falls back to a generic error for a non-JSON error body (e.g. a proxy 500 HTML page)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html>Internal Server Error</html>', { status: 500 }),
    );

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });

    await expect(client.health()).rejects.toBeInstanceOf(ClientError);
  });

  it('builds list query params (tag, limit, cursor)', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ links: [] }, 200));

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });
    await client.list({ tag: 'ai', limit: 10, cursor: 'abc' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8787/api/links?tag=ai&limit=10&cursor=abc');
  });

  it('search encodes the query string', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }, 200));

    const client = new Client({ baseUrl: 'http://localhost:8787', token: undefined });
    await client.search('hello world');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8787/api/links/search?q=hello+world');
  });
});
