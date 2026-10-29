import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LinkJson } from '../../api/types';
import { makeLink } from '../../test/fixtures';
import { RowMenuProvider } from '../RowMenuContext';
import { ReaderPane } from './ReaderPane';
import { useReaderActions } from './useReaderActions';

const link = makeLink({ id: 'toolbar', extractedText: 'Saved article text.' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function Pane({
  value = link,
  selectedId = value?.id ?? null,
}: {
  value?: LinkJson | null;
  selectedId?: string | null;
}) {
  const [tab, setTab] = useState<'reader' | 'original'>('reader');
  const actions = useReaderActions(value ?? undefined, false, () => {});
  return (
    <ReaderPane
      link={value ?? undefined}
      selectedId={selectedId}
      tab={tab}
      setTab={setTab}
      close={() => {}}
      step={() => {}}
      index={0}
      canGoNext={false}
      actions={actions}
      trashed={false}
      purgeWindowDays={30}
      loading={Boolean(selectedId) && !value}
    />
  );
}

function show(value: LinkJson | null = link, selectedId?: string | null) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/frame')
      ? json({ mode: 'direct', darkTheme: false })
      : json({ tags: [] }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (value: LinkJson | null) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RowMenuProvider>
          <Pane
            value={value}
            selectedId={selectedId === undefined ? (value?.id ?? null) : selectedId}
          />
        </RowMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(value));
  return { ...view, fetchMock, select: (value: LinkJson) => view.rerender(tree(value)) };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout);
});

function scrollPane(container: HTMLElement) {
  const scroller = container.querySelector('.silo-reader-scroll') as HTMLElement;
  const head = container.querySelector('.silo-reader-head') as HTMLElement;
  Object.defineProperties(scroller, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 600 },
  });
  const scroll = async (top: number) => {
    await act(async () => {
      fireEvent.scroll(scroller, { target: { scrollTop: top } });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  };
  return { scroller, head, scroll };
}

it('keeps an empty header band with no selection', () => {
  const { container } = show(null);
  const head = container.querySelector('.silo-reader-head');
  expect(head).not.toBeNull();
  expect(head?.childElementCount).toBe(0);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('tab')).toBeNull();
});

it('disables both segment tabs while the selected link loads', () => {
  show(null, 'loading');
  expect(screen.getByRole('status').textContent).toBe('Loading link…');
  for (const tab of screen.getAllByRole('tab')) {
    expect((tab as HTMLButtonElement).disabled).toBe(true);
  }
  expect(screen.getByRole('tab', { name: 'Reader' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('button', { name: 'Close reader' })).toBeDefined();
});

it('reveals on toolbar focus and stays shown until focus leaves', async () => {
  const { container } = show();
  const { head, scroll } = scrollPane(container);
  await scroll(200);
  expect(head.dataset.hidden).toBe('true');
  act(() => screen.getByRole('button', { name: 'Close reader' }).focus());
  expect(head.dataset.hidden).toBe('false');
  await scroll(240);
  expect(head.dataset.hidden).toBe('false');
  act(() => (document.activeElement as HTMLElement).blur());
  await scroll(260);
  expect(head.dataset.hidden).toBe('true');
});

it.each(['More actions', 'View settings'])('pins the bar while %s is open', async (label) => {
  const { container } = show();
  const { head, scroll } = scrollPane(container);
  await scroll(200);
  fireEvent.click(screen.getByRole('button', { name: label }));
  // Move focus out to prove the open menu itself pins the header.
  act(() => (document.activeElement as HTMLElement).blur());
  await scroll(240);
  expect(head.dataset.hidden).toBe('false');
  fireEvent.keyDown(document, { key: 'Escape' });
  act(() => (document.activeElement as HTMLElement).blur());
  await scroll(260);
  expect(head.dataset.hidden).toBe('true');
});

it('resets a hidden bar, scroll position, and open menus when the selected link changes', async () => {
  const { container, select } = show();
  const { head, scroll, scroller } = scrollPane(container);
  await scroll(200);
  expect(head.dataset.hidden).toBe('true');
  select(makeLink({ id: 'next', title: 'Next article' }));
  expect(head.dataset.hidden).toBe('false');
  expect(scroller.scrollTop).toBe(0);
  await scroll(100);
  expect(head.dataset.hidden).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  select(link);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(head.dataset.hidden).toBe('false');
});

it('shows the bar when switching tabs and keeps it visible in Live', async () => {
  const { container } = show();
  const { head, scroll, scroller } = scrollPane(container);
  await scroll(200);
  fireEvent.click(screen.getByRole('tab', { name: 'Live' }));
  expect(head.dataset.hidden).toBe('false');
  expect(scroller.scrollTop).toBe(0);
  await scroll(240);
  expect(head.dataset.hidden).toBe('false');
  fireEvent.click(screen.getByRole('tab', { name: 'Reader' }));
  expect(head.dataset.hidden).toBe('false');
  expect(scroller.scrollTop).toBe(0);
});

it('reveals in the top hover zone only on hover-capable devices', async () => {
  const { container } = show();
  const { head, scroll } = scrollPane(container);
  const pane = screen.getByRole('region', { name: 'Link reader' });
  await scroll(200);
  fireEvent.pointerMove(pane, { clientY: 10 });
  expect(head.dataset.hidden).toBe('true');
  const media = window.matchMedia;
  vi.stubGlobal('matchMedia', (query: string) => ({
    ...media(query),
    matches: query === '(hover: hover) and (pointer: fine)',
  }));
  fireEvent.pointerMove(pane, { clientY: 10 });
  expect(head.dataset.hidden).toBe('false');
  await scroll(240);
  expect(head.dataset.hidden).toBe('false');
  fireEvent.pointerLeave(pane);
  await scroll(260);
  expect(head.dataset.hidden).toBe('true');
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
    'Refresh readerr',
    'Tags',
    'Enrich',
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
  ).toEqual([
    'Edite',
    'Reload page',
    'Open originalo',
    'Copy linkc',
    'Refresh readerr',
    'Tags',
    'Enrich',
    'Move to trash⌫',
  ]);
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
