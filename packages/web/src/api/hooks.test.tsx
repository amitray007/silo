import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys, useCounts, useTags } from './hooks';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('queryKeys', () => {
  it('builds stable, distinct keys for later invalidation', () => {
    expect(queryKeys.counts()).toEqual(['counts']);
    expect(queryKeys.tags()).toEqual(['tags']);
    expect(queryKeys.links({ tag: 'mcp' })).toEqual(['links', { tag: 'mcp' }]);
    expect(queryKeys.links()).toEqual(['links', {}]);
    expect(queryKeys.link('abc')).toEqual(['link', 'abc']);
  });
});

describe('useCounts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes from loading to success with the counts payload', async () => {
    const counts = { live: 12, trash: 3, purgeWindowDays: 30 };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(counts));

    const { result } = renderHook(() => useCounts(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(counts);
    expect(fetch).toHaveBeenCalledWith('/api/counts');
  });

  it('surfaces an error state when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: 'internal_error', message: 'Internal server error' }, 500),
    );

    const { result } = renderHook(() => useCounts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 500, error: 'internal_error' });
  });
});

describe('useTags', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes from loading to success with the tags payload', async () => {
    const tags = {
      tags: [
        { name: 'mcp', count: 4 },
        { name: 'essays', count: 2 },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(tags));

    const { result } = renderHook(() => useTags(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(tags);
    expect(fetch).toHaveBeenCalledWith('/api/tags');
  });
});
