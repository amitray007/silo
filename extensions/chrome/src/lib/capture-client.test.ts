import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureError, captureLink, checkHealth, listTags } from './capture-client.js';
import { saveSettings } from './settings.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('capture-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /api/links with the default base URL and no Authorization header when no token is set', async () => {
    const link = {
      id: 'abc',
      url: 'https://example.com',
      title: null,
      notes: null,
      tags: [],
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
    expect(result.deduped).toBe(false);
  });

  it('sends Authorization: Bearer when a token is configured', async () => {
    await saveSettings({ baseUrl: 'http://localhost:8787', token: 'sekret' });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          link: {
            id: '1',
            url: 'https://x.com',
            title: null,
            notes: null,
            tags: [],
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

  it('uses the configured base URL, not the default', async () => {
    await saveSettings({ baseUrl: 'https://silo.example.com', token: '' });
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          link: {
            id: '1',
            url: 'https://x.com',
            title: null,
            notes: null,
            tags: [],
          },
          deduped: false,
        },
        201,
      ),
    );

    await captureLink({ url: 'https://x.com' });

    expect(fetch).toHaveBeenCalledWith('https://silo.example.com/api/links', expect.anything());
  });

  it('throws a CaptureError(unreachable) when fetch rejects (network failure or CORS block)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(captureLink({ url: 'https://example.com' })).rejects.toMatchObject({
      name: 'CaptureError',
      kind: 'unreachable',
    });
  });

  it('throws a CaptureError(unauthorized) on 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'unauthorized', message: 'nope' }, 401),
    );

    const error = await captureLink({ url: 'https://example.com' }).catch((e) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as CaptureError).kind).toBe('unauthorized');
  });

  it('throws a CaptureError(invalid) on 400 with the server message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'validation_error', message: 'bad url' }, 400),
    );

    const error = await captureLink({ url: 'not-a-url' }).catch((e) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as CaptureError).kind).toBe('invalid');
    expect((error as CaptureError).message).toBe('bad url');
  });

  it('throws a CaptureError(server) on 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));

    const error = await captureLink({ url: 'https://example.com' }).catch((e) => e);
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as CaptureError).kind).toBe('server');
  });

  it('listTags fetches GET /api/tags and returns the tags array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ tags: [{ name: 'ai', count: 3 }] }));

    const tags = await listTags();
    expect(tags).toEqual([{ name: 'ai', count: 3 }]);
  });

  it('checkHealth returns true on 2xx and false on network failure, without going through apiFetch (no auth header)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(checkHealth('http://localhost:8787')).resolves.toBe(true);

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(checkHealth('http://localhost:8787')).resolves.toBe(false);
  });
});

describe('editNote', () => {
  it('PATCHes the note and returns the link', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ link: { id: '1', url: 'u', title: null, notes: 'hi', tags: [] } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { editNote } = await import('./capture-client.js');
    const link = await editNote('1', 'hi');
    expect(link.notes).toBe('hi');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/links/1'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('removeTag', () => {
  it('URL-encodes the tag in the path', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ link: { id: '1', url: 'u', title: null, notes: null, tags: [] } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { removeTag } = await import('./capture-client.js');
    await removeTag('1', 'a b');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/links/1/tags/a%20b'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
