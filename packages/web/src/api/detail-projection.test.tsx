import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { queryKeys, useLink, useLiveReader } from './hooks';

const reader = {
  contentHtml: '<h2>Searchable heading</h2><p>Copy and outline prose</p>',
  contentImages: [],
  capturedAt: null,
};
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
afterEach(() => vi.unstubAllGlobals());

it('loads projected details and shares the HTML query used by prose, selection copy, search, and outline', async () => {
  const link = makeLink({ readerTextOmitted: true, extractedText: null });
  const fetcher = vi.fn(async (input: string) =>
    Response.json(input.endsWith('/reader') ? reader : { link }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { wrapper, client } = setup();
  const detail = renderHook(() => useLink(link.id), { wrapper });
  await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    `/api/links/${link.id}?view=reader`,
    `/api/links/${link.id}/reader`,
  ]);
  expect(client.getQueryData(queryKeys.liveReader(link.id))).toEqual(reader);
  const prose = renderHook(() => useLiveReader(link.id, true), { wrapper });
  expect(prose.result.current.data?.contentHtml).toContain('Copy and outline prose');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps the plain-text fallback without fetching HTML when no current stored Reader exists', async () => {
  const link = makeLink({ extractedText: 'Full fallback body' });
  const fetcher = vi.fn(async () => Response.json({ link }));
  vi.stubGlobal('fetch', fetcher);
  const { wrapper } = setup();
  const detail = renderHook(() => useLink(link.id), { wrapper });
  await waitFor(() =>
    expect(detail.result.current.data?.link.extractedText).toBe('Full fallback body'),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reloads full text when projected HTML fails, so a Reader failure can still render its text', async () => {
  const projected = makeLink({ readerTextOmitted: true, extractedText: null });
  const full = makeLink({ extractedText: 'Full fallback after HTML failure' });
  const fetcher = vi.fn(async (input: string) => {
    if (input.endsWith('/reader'))
      return Response.json({ error: 'not_found', message: 'No Reader' }, { status: 404 });
    return Response.json({ link: input.includes('?') ? projected : full });
  });
  vi.stubGlobal('fetch', fetcher);
  const { wrapper } = setup();
  const detail = renderHook(() => useLink(projected.id), { wrapper });
  await waitFor(() =>
    expect(detail.result.current.data?.link.extractedText).toBe(full.extractedText),
  );
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    `/api/links/${projected.id}?view=reader`,
    `/api/links/${projected.id}/reader`,
    `/api/links/${projected.id}`,
  ]);
});
