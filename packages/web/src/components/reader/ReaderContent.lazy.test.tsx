import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { LiveReaderJson } from '../../api/types';
import { makeLink } from '../../test/fixtures';
import { ReaderContent } from './ReaderContent';

const reader = vi.hoisted(() => ({ data: undefined as LiveReaderJson | undefined }));
const dock = vi.hoisted(() => {
  let resolve = () => {};
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, resolve, loaded: false };
});
vi.mock('../../api/hooks', async (original) => ({
  ...(await original<typeof import('../../api/hooks')>()),
  useLiveReader: () => ({ data: reader.data, isLoading: false }),
}));
vi.mock('./dock/ReaderDock', async () => {
  dock.loaded = true;
  await dock.ready;
  return { ReaderDock: () => <div role="toolbar" aria-label="Loaded reader tools" /> };
});

it('preloads tools on mount and keeps the article visible while they load', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const link = makeLink({ extractedText: 'Plain fallback article.', description: null });
  const content = (
    <QueryClientProvider client={client}>
      <ReaderContent link={link} />
    </QueryClientProvider>
  );
  const view = render(content);
  expect(screen.getByText('Plain fallback article.')).toBeDefined();
  await waitFor(() => expect(dock.loaded).toBe(true));
  reader.data = {
    contentHtml: '<p>Captured article stays visible.</p>',
    contentImages: [],
    capturedAt: '2026-11-02T00:00:00Z',
  };
  view.rerender(
    <QueryClientProvider client={client}>
      <ReaderContent link={link} />
    </QueryClientProvider>,
  );
  const prose = screen.getByText('Captured article stays visible.');
  expect(screen.queryByRole('toolbar', { name: 'Loaded reader tools' })).toBeNull();
  await act(async () => {
    dock.resolve();
  });
  expect(await screen.findByRole('toolbar', { name: 'Loaded reader tools' })).toBeDefined();
  expect(screen.getByText('Captured article stays visible.')).toBe(prose);
  view.unmount();
  client.clear();
});
