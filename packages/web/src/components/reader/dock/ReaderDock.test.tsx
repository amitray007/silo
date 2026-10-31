import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLink, twitterSourceData } from '../../../test/fixtures';
import { ReaderContent } from '../ReaderContent';
import { DockHostContext, ReaderDock } from './ReaderDock';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Host({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <DockHostContext.Provider
      value={{ element: host, scroll: host, panel: host, report: () => {} }}
    >
      {children}
      <div ref={setHost} data-testid="host" />
    </DockHostContext.Provider>
  );
}

function renderContent(link = makeLink({ id: 'dock' }), reader: unknown = null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/reader') && reader
        ? json(reader)
        : json({ error: 'not_found', message: 'none' }, 404),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Host>
        <ReaderContent link={link} />
      </Host>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const prose = { capturedAt: null, contentHtml: '<p>Body text</p>', contentImages: [] };

it('renders for readable article prose', async () => {
  renderContent(undefined, prose);
  await screen.findByText('Body text');
  const toolbar = screen.getByRole('toolbar', { name: 'Reader tools' });
  expect(toolbar.closest('[data-testid="host"]')).not.toBeNull();
  expect(screen.getAllByRole('button', { name: 'Type' })).toHaveLength(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not render when the page has no Reader prose', async () => {
  renderContent(); // the live Reader answers 404, so the stored text shows instead
  await waitFor(() => expect(screen.queryByLabelText('Loading article')).toBeNull());
  expect(screen.queryByRole('toolbar', { name: 'Reader tools' })).toBeNull();
});

it('does not render for an X post and never asks for Reader prose', async () => {
  renderContent(
    makeLink({
      id: 'post',
      url: 'https://x.com/amitray007/status/1',
      sourceData: twitterSourceData,
    }),
    prose,
  );
  // Let any query that was going to start do so, so a missing guard shows up as a fetch.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.queryByRole('toolbar', { name: 'Reader tools' })).toBeNull();
  const fetched = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
  expect(fetched.some((url) => url.endsWith('/reader'))).toBe(false);
});

it('renders nothing when no pane hosts it', () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <ReaderDock link={makeLink({ id: 'none' })} prose={null} />
    </QueryClientProvider>,
  );
  expect(container.innerHTML).toBe('');
});

it('opens and toggles the Type sheet and reports its state', async () => {
  renderContent(undefined, prose);
  const button = await screen.findByRole('button', { name: 'Type' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('dialog', { name: 'Type' })).toBeDefined();
  expect(button.getAttribute('aria-controls')).toBeTruthy();
  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('false');
});

it('closes the sheet on Escape before anything else sees the key', async () => {
  const outer = vi.fn();
  document.addEventListener('keydown', outer);
  renderContent(undefined, prose);
  fireEvent.click(await screen.findByRole('button', { name: 'Type' }));
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Inter' }), { key: 'Escape' });
  expect(outer).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Type' })).toBeNull());
  // With the sheet gone, Escape reaches the reader's own handling again.
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(outer).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', outer);
});

it('closes the sheet on an outside press and keeps the dock', async () => {
  renderContent(undefined, prose);
  fireEvent.click(await screen.findByRole('button', { name: 'Type' }));
  fireEvent.mouseDown(document.body);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Type' })).toBeNull());
  expect(screen.getByRole('toolbar', { name: 'Reader tools' })).toBeDefined();
});

it('closes the sheet when the open link changes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(prose)),
  );
  const tree = (id: string) => (
    <QueryClientProvider client={client}>
      <Host>
        <ReaderContent link={makeLink({ id })} />
      </Host>
    </QueryClientProvider>
  );
  const view = render(tree('first'));
  fireEvent.click(await screen.findByRole('button', { name: 'Type' }));
  expect(screen.getByRole('dialog', { name: 'Type' })).toBeDefined();
  view.rerender(tree('second'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Type' })).toBeNull());
  expect((await screen.findByRole('button', { name: 'Type' })).getAttribute('aria-expanded')).toBe(
    'false',
  );
});

it('titles the sheet and closes it from the header button', async () => {
  renderContent(undefined, prose);
  const trigger = await screen.findByRole('button', { name: 'Type' });
  fireEvent.click(trigger);
  expect(screen.getByRole('heading', { name: 'Typography' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Type' })).toBeNull());
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('lists the Pencil split button beside Type, with a sheet chevron', async () => {
  renderContent(undefined, prose);
  const main = await screen.findByRole('button', { name: 'Pencil' });
  expect(main.getAttribute('title')).toBe('Reading pencil (P)');
  expect(main.getAttribute('aria-pressed')).toBe('false');
  const chevron = screen.getByRole('button', { name: 'Pencil settings' });
  expect(chevron.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(chevron);
  expect(screen.getByRole('dialog', { name: 'Pencil' })).toBeDefined();
  expect(screen.getByRole('heading', { name: 'Reading pencil' })).toBeDefined();
  expect(chevron.getAttribute('aria-expanded')).toBe('true');
});

it('keeps the pencil sheet to controls: play, speed, progress and style', async () => {
  renderContent(undefined, prose);
  fireEvent.click(await screen.findByRole('button', { name: 'Pencil settings' }));
  const sheet = screen.getByRole('dialog', { name: 'Pencil' });
  expect(screen.getByRole('button', { name: 'Start pencil' }).getAttribute('title')).toBe(
    'Play (Space)',
  );
  expect(screen.getByRole('spinbutton', { name: 'Speed' }).getAttribute('aria-valuenow')).toBe(
    '240',
  );
  expect(screen.getByRole('button', { name: 'Decrease speed' }).getAttribute('title')).toBe(
    'Slower (-)',
  );
  expect(screen.getByRole('progressbar', { name: 'Reading progress' })).toBeDefined();
  expect(sheet.querySelector('p')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Highlighter' }));
  expect(JSON.parse(localStorage.getItem('silo.readerPencil') ?? '{}').style).toBe('highlighter');
});

it('stops the speed stepper at 100 and 600 wpm', async () => {
  localStorage.setItem('silo.readerPencil', JSON.stringify({ v: 1, wpm: 100 }));
  renderContent(undefined, prose);
  fireEvent.click(await screen.findByRole('button', { name: 'Pencil settings' }));
  expect(
    (screen.getByRole('button', { name: 'Decrease speed' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Increase speed' }));
  expect(screen.getByRole('spinbutton', { name: 'Speed' }).getAttribute('aria-valuenow')).toBe(
    '120',
  );
  localStorage.setItem('silo.readerPencil', JSON.stringify({ v: 1, wpm: 600 }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'silo.readerPencil' }));
  expect(
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Increase speed' }) as HTMLButtonElement;
      if (!button.disabled) throw new Error('still enabled');
      return button.disabled;
    }),
  ).toBe(true);
});
