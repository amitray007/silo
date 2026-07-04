import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, setApiBaseUrl } from './client';
import type {
  AddedBy,
  CaptureStatus,
  Counts,
  LinkJson,
  LinkResponse,
  LinksResponse,
  SearchResponse,
  SearchResultJson,
  TagCount,
  TagsResponse,
  TrashLinkJson,
  TrashResponse,
} from './types';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A fixture `LinkJson`, typed against the real response shape (not just an
 * inline object literal) so a typo in `types.ts` (a missing/renamed field)
 * fails this test file's type-check, not just at some future consumer.
 */
const linkFixture: LinkJson = {
  id: '11111111-1111-1111-1111-111111111111',
  url: 'https://example.com/post',
  title: 'A post',
  description: null,
  imageUrl: null,
  siteName: 'example.com',
  extractedText: null,
  sourceKind: 'web',
  captureStatus: 'full',
  addedBy: 'user',
  notes: null,
  tags: ['mcp'],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('apiGet', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the typed body on a 200', async () => {
    const counts: Counts = { live: 12, trash: 3, purgeWindowDays: 30 };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(counts, 200));

    await expect(apiGet<Counts>('/api/counts')).resolves.toEqual(counts);
  });

  it('resolves against an overridden base URL set by setApiBaseUrl', async () => {
    setApiBaseUrl('http://localhost:8787');
    try {
      const tags: TagsResponse = { tags: [{ name: 'mcp', count: 1 }] };
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(tags, 200));

      await expect(apiGet<TagsResponse>('/api/tags')).resolves.toEqual(tags);
      expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/tags');
    } finally {
      setApiBaseUrl('');
    }
  });

  it('types the full response envelope surface (links/search/trash/single link)', async () => {
    const linksResponse: LinksResponse = { links: [linkFixture], nextCursor: 'c1' };
    const searchResult: SearchResultJson = { ...linkFixture, rank: 0.9 };
    const searchResponse: SearchResponse = { results: [searchResult] };
    const trashLink: TrashLinkJson = { ...linkFixture, deletedAt: '2026-07-02T00:00:00.000Z' };
    const trashResponse: TrashResponse = { links: [trashLink] };
    const linkResponse: LinkResponse = { link: linkFixture };

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(linksResponse, 200))
      .mockResolvedValueOnce(jsonResponse(searchResponse, 200))
      .mockResolvedValueOnce(jsonResponse(trashResponse, 200))
      .mockResolvedValueOnce(jsonResponse(linkResponse, 200));

    await expect(apiGet<LinksResponse>('/api/links')).resolves.toEqual(linksResponse);
    await expect(apiGet<SearchResponse>('/api/links/search?q=x')).resolves.toEqual(searchResponse);
    await expect(apiGet<TrashResponse>('/api/trash')).resolves.toEqual(trashResponse);
    await expect(apiGet<LinkResponse>(`/api/links/${linkFixture.id}`)).resolves.toEqual(
      linkResponse,
    );
  });

  it('throws a typed ApiError with status/code/message on a 404 error envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'not_found', message: 'No link with id abc' }, 404),
    );

    const failure = apiGet('/api/links/abc');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 404,
      error: 'not_found',
      message: 'No link with id abc',
    });
  });

  it('carries optional details from the error envelope', async () => {
    const details = [{ path: ['q'], message: 'Required' }];
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: 'validation_error', message: 'Request validation failed', details },
        400,
      ),
    );

    const failure = apiGet('/api/links/search');
    await expect(failure).rejects.toMatchObject({
      status: 400,
      error: 'validation_error',
      details,
    });
  });

  it('throws a sane ApiError on a non-JSON 500 body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html>Internal Server Error</html>', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'text/html' },
      }),
    );

    const failure = apiGet('/api/counts');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 500 });
  });

  it('throws an ApiError (not a raw TypeError) on a network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const failure = apiGet('/api/counts');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 0, error: 'network_error' });
  });

  it('throws a sane ApiError when a 200 response body is not valid JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const failure = apiGet('/api/counts');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 200, error: 'invalid_response' });
  });
});

describe('type fidelity', () => {
  it('accepts every CaptureStatus/AddedBy union member on a LinkJson', () => {
    const allCaptureStatuses: CaptureStatus[] = ['enriching', 'full', 'partial', 'bare'];
    const allAddedByValues: AddedBy[] = ['user', 'agent'];

    for (const captureStatus of allCaptureStatuses) {
      for (const addedBy of allAddedByValues) {
        const link: LinkJson = { ...linkFixture, captureStatus, addedBy };
        expect(link.captureStatus).toBe(captureStatus);
        expect(link.addedBy).toBe(addedBy);
      }
    }
  });

  it('shapes a TagCount as GET /api/tags returns it', () => {
    const tag: TagCount = { name: 'mcp', count: 4 };
    expect(tag).toEqual({ name: 'mcp', count: 4 });
  });
});
