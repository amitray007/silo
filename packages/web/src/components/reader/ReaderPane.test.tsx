import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLink } from '../../test/fixtures';
import { RowMenuProvider } from '../RowMenuContext';
import { ReaderPane } from './ReaderPane';
import { useReaderActions } from './useReaderActions';

const link = makeLink({ id: 'toolbar', extractedText: 'Saved article text.' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function Pane() {
  const [tab, setTab] = useState<'reader' | 'original'>('reader');
  const actions = useReaderActions(link, false, () => {});
  return (
    <ReaderPane
      link={link}
      selectedId={link.id}
      tab={tab}
      setTab={setTab}
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

function show() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/frame')
      ? json({ mode: 'direct', darkTheme: false })
      : json({ tags: [] }),
  );
  vi.stubGlobal('fetch', fetchMock);
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
  return { ...view, fetchMock };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.dataset.theme = 'light';
});

it('keeps only five controls inline and orders Edit and Reload before existing menu items', async () => {
  const { container } = show();
  const tools = within(container.querySelector('.silo-reader-right') as HTMLElement);
  const labels = () =>
    tools.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
  expect(labels()).toEqual([
    'View settings',
    'Copy link',
    'Open original',
    'Move to trash',
    'More actions',
  ]);
  fireEvent.click(tools.getByRole('button', { name: 'More actions' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    'Edite',
    'Open originalo',
    'Copy linkc',
    'Tags',
    'Move to trash⌫',
  ]);
  expect(screen.queryByRole('menuitem', { name: 'Reload page' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('tab', { name: 'Live' }));
  await screen.findByTitle('Live page');
  await waitFor(() => expect(labels()).toHaveLength(5));
  fireEvent.click(tools.getByRole('button', { name: 'More actions' }));
  const menu = screen.getByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual(['Edite', 'Reload page', 'Open originalo', 'Copy linkc', 'Tags', 'Move to trash⌫']);
  const edit = within(menu).getByRole('menuitem', { name: 'Edit' });
  const reload = within(menu).getByRole('menuitem', { name: 'Reload page' });
  expect(edit.nextElementSibling).toBe(reload);
  expect(reload.nextElementSibling?.className).toBe('silo-menu-separator');
});

it('reloads from More, disables another reload while pending, and keeps the frame on failure', async () => {
  const { fetchMock } = show();
  fireEvent.click(screen.getByRole('tab', { name: 'Live' }));
  const originalFrame = await screen.findByTitle('Live page');
  let finish: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Reload page' }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/links/toolbar/frame?fresh=1', expect.anything()),
  );
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Reload page' }).disabled).toBe(
    true,
  );
  finish?.(json({ error: 'service_unavailable', message: 'Unavailable' }, 503));
  expect((await screen.findByRole('alert')).textContent).toBe('Refresh failed');
  expect(screen.getByTitle('Live page')).toBe(originalFrame);
  expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Reload page' }).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Reload page' }));
  await waitFor(() => expect(screen.getByTitle('Live page')).not.toBe(originalFrame));
  expect(screen.queryByRole('alert')).toBeNull();
});
