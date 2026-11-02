import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { makeLink } from '../../test/fixtures';
import { RowMenuProvider } from '../RowMenuContext';
import { ReaderPane } from './ReaderPane';
import { useReaderActions } from './useReaderActions';

const dock = vi.hoisted(() => {
  let resolve = () => {};
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, resolve };
});
vi.mock('./dock/ReaderDock', async () => {
  await dock.ready;
  return { ReaderDock: () => <div role="toolbar" aria-label="Loaded tools" /> };
});
vi.mock('../../api/hooks', async (original) => ({
  ...(await original<typeof import('../../api/hooks')>()),
  useLiveReader: () => ({
    data: { contentHtml: '<p>Article</p>', contentImages: [], capturedAt: 'now' },
    isLoading: false,
  }),
}));

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('applies the Reader theme before the dock import resolves', async () => {
  localStorage.setItem('silo.readerType', JSON.stringify({ v: 1, theme: 'sepia' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ tags: [] }))),
  );
  const link = makeLink({ id: 'theme-pending-dock' });
  function Pane() {
    const actions = useReaderActions(link, false, () => {});
    return (
      <ReaderPane
        link={link}
        selectedId={link.id}
        tab="reader"
        setTab={() => {}}
        close={() => {}}
        step={() => {}}
        index={0}
        canGoNext={false}
        actions={actions}
        trashed={false}
        purgeWindowDays={30}
        loading={false}
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RowMenuProvider>
          <Pane />
        </RowMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Article');
  expect(view.container.querySelector('.silo-readerpane')?.getAttribute('data-reader-theme')).toBe(
    'sepia',
  );
  expect(screen.queryByRole('toolbar', { name: 'Loaded tools' })).toBeNull();
  await act(async () => dock.resolve());
  await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Loaded tools' })).toBeDefined());
  view.unmount();
  client.clear();
});
