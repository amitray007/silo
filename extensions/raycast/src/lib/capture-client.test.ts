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

  describe('browseLinks', () => {
    it('GETs /api/links with no query when no tag filter is given', async () => {
      const { browseLinks } = await import('./capture-client.js');
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ links: [] }));

      const result = await browseLinks();

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.links).toEqual([]);
    });

    it('GETs /api/links?tag= when a tag filter is given', async () => {
      const { browseLinks } = await import('./capture-client.js');
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ links: [] }));

      await browseLinks({ tag: 'a b' });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links?tag=a%20b',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('listTrash', () => {
    it('GETs /api/trash and returns the links array', async () => {
      const { listTrash } = await import('./capture-client.js');
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ links: [] }));

      const result = await listTrash();

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/trash',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.links).toEqual([]);
    });
  });

  describe('editNote', () => {
    it('PATCHes note and unwraps link', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({ link: { id: '1', notes: 'hi', tags: [] } }, 200),
      );
      const { editNote } = await import('./capture-client.js');
      const link = await editNote('1', 'hi');
      expect(link.notes).toBe('hi');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links/1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ note: 'hi' }) }),
      );
    });
  });

  describe('addTag', () => {
    it('POSTs the tag and unwraps link', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: { id: '1', tags: ['x'] } }, 200));
      const { addTag } = await import('./capture-client.js');
      const link = await addTag('1', 'x');
      expect(link.tags).toEqual(['x']);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links/1/tags',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag: 'x' }) }),
      );
    });
  });

  describe('removeTag', () => {
    it('URL-encodes the tag path segment', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: { id: '1', tags: [] } }, 200));
      const { removeTag } = await import('./capture-client.js');
      await removeTag('1', 'a b');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links/1/tags/a%20b',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('trashLink / restoreLink / retryLink', () => {
    it('trashLink POSTs /api/links/:id/trash and unwraps link', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: { id: '1' } }, 200));
      const { trashLink } = await import('./capture-client.js');
      const link = await trashLink('1');
      expect(link.id).toBe('1');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links/1/trash',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('restoreLink POSTs /api/links/:id/restore', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: { id: '1' } }, 200));
      const { restoreLink } = await import('./capture-client.js');
      await restoreLink('1');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links/1/restore',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('retryLink POSTs /api/links/:id/retry', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: { id: '1' } }, 200));
      const { retryLink } = await import('./capture-client.js');
      await retryLink('1');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/links/1/retry',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('emptyTrash', () => {
    it('DELETEs /api/trash and tolerates a 204 no-body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
      const { emptyTrash } = await import('./capture-client.js');
      await expect(emptyTrash()).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/trash',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('deleteTrashed', () => {
    it('DELETEs /api/trash/:id and tolerates a 204 no-body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
      const { deleteTrashed } = await import('./capture-client.js');
      await expect(deleteTrashed('1')).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/trash/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('listTags', () => {
    it('GETs /api/tags and unwraps the tags array', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ tags: [{ name: 'react', count: 3 }] }));
      const { listTags } = await import('./capture-client.js');
      const tags = await listTags();
      expect(tags).toEqual([{ name: 'react', count: 3 }]);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/tags',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getCounts', () => {
    it('GETs /api/counts', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({ total: 10, trashed: 2, purgeWindowDays: 30 }),
      );
      const { getCounts } = await import('./capture-client.js');
      const counts = await getCounts();
      expect(counts.purgeWindowDays).toBe(30);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8787/api/counts',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });
});
