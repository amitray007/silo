import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPreferenceValues = vi.fn();

vi.mock('@raycast/api', () => ({
  getPreferenceValues: (...args: unknown[]) => getPreferenceValues(...args),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('capture-client', () => {
  beforeEach(() => {
    getPreferenceValues.mockReturnValue({ baseUrl: 'http://localhost:8787' });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('POSTs to /api/links with the configured base URL and no Authorization header when no token is set', async () => {
    const { captureLink } = await import('./capture-client.js');
    const link = {
      id: 'abc',
      url: 'https://example.com',
      title: null,
      description: null,
      siteName: null,
      sourceKind: 'link',
      sourceData: { kind: 'link' },
      captureStatus: 'enriching',
      notes: null,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link, deduped: false }, 201));

    const result = await captureLink({ url: 'https://example.com' });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/links',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false);
    expect(result.link.id).toBe('abc');
  });

  it('sends Authorization: Bearer when a token is configured', async () => {
    getPreferenceValues.mockReturnValue({ baseUrl: 'http://localhost:8787', token: 'sekret' });
    const { captureLink } = await import('./capture-client.js');
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          link: {
            id: '1',
            url: 'https://x.com',
            title: null,
            description: null,
            siteName: null,
            sourceKind: 'link',
            sourceData: { kind: 'link' },
            captureStatus: 'full',
            notes: null,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          deduped: false,
        },
        201,
      ),
    );

    await captureLink({ url: 'https://x.com' });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer sekret');
  });

  it('throws a CaptureError(unreachable) when fetch rejects', async () => {
    const { CaptureError, captureLink } = await import('./capture-client.js');
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));

    const error = await captureLink({ url: 'https://example.com' }).catch((e) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as InstanceType<typeof CaptureError>).kind).toBe('unreachable');
  });

  it('throws a CaptureError(unauthorized) on 401', async () => {
    const { CaptureError, captureLink } = await import('./capture-client.js');
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'unauthorized', message: 'nope' }, 401),
    );

    const error = await captureLink({ url: 'https://example.com' }).catch((e) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as InstanceType<typeof CaptureError>).kind).toBe('unauthorized');
  });

  it('throws a CaptureError(invalid) on 400 with the server message', async () => {
    const { CaptureError, captureLink } = await import('./capture-client.js');
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'validation_error', message: 'bad url' }, 400),
    );

    const error = await captureLink({ url: 'not-a-url' }).catch((e) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as InstanceType<typeof CaptureError>).message).toBe('bad url');
  });

  it('throws a CaptureError(server) on 500', async () => {
    const { CaptureError, captureLink } = await import('./capture-client.js');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));

    const error = await captureLink({ url: 'https://example.com' }).catch((e) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as InstanceType<typeof CaptureError>).kind).toBe('server');
  });

  it('searchLinks fetches GET /api/links/search?q= and returns the results array', async () => {
    const { searchLinks } = await import('./capture-client.js');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ results: [] }));

    const result = await searchLinks('hello world');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8787/api/links/search?q=hello%20world',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.results).toEqual([]);
  });
});
