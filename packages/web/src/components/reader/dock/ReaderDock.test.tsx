import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { BrowserRouter, Link, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeLink, twitterSourceData } from '../../../test/fixtures';
import { articlePrefs, TestArticlePrefs } from '../../../test/reader-prefs';
import { HoverPreviewProvider } from '../../HoverPreviewContext';
import { ReaderContent } from '../ReaderContent';
import { useReaderNavigation } from '../useReaderNavigation';
import { DockHostContext } from './DockHostContext';
import { ReaderDock } from './ReaderDock';

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

function renderContent(
  link = makeLink({ id: 'dock' }),
  reader: unknown = null,
  ready = false,
  chats: unknown[] = [],
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/api/ai')
        ? json({ status: { features: { librarian: { ready } } } })
        : String(input).includes('/librarian/chats?')
          ? json({ chats, nextCursor: null })
          : String(input).endsWith('/reader') && reader
            ? json(reader)
            : json({ error: 'not_found', message: 'none' }, 404),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Host>
        <TestArticlePrefs link={link}>
          <ReaderContent link={link} />
        </TestArticlePrefs>
      </Host>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({ idx: 0, key: 'list' }, '', '/');
  window.history.pushState({ idx: 1, key: 'article' }, '', '/?link=dock');
});
afterEach(async () => {
  cleanup();
  await waitFor(() => expect(window.history.state?.siloDock).toBeUndefined());
  vi.unstubAllGlobals();
});

const prose = { capturedAt: null, contentHtml: '<p>Body text</p>', contentImages: [] };

it('renders for readable article prose', async () => {
  renderContent(undefined, prose);
  await screen.findByText('Body text');
  // The first test in the file pays the cold module load; under the full suite it passes 1s.
  const toolbar = await screen.findByRole('toolbar', { name: 'Reader tools' }, { timeout: 3000 });
  expect(toolbar.closest('[data-testid="host"]')).not.toBeNull();
  expect(screen.getAllByRole('button', { name: 'Type' })).toHaveLength(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

const storedChat = { id: 'c1', title: 'Earlier', linkId: 'dock', createdAt: '', updatedAt: '' };

it('marks the dock Ask when the article has a stored chat', async () => {
  renderContent(undefined, prose, true, [storedChat]);
  const ask = await screen.findByRole('button', { name: /^Ask/ });
  await waitFor(() => expect(ask.querySelector('.silo-reader-dockmark > i')).not.toBeNull());
  expect(ask.textContent).toContain('Earlier chat saved');
});

it('leaves the dock Ask unmarked without a stored chat', async () => {
  renderContent(undefined, prose, true);
  const ask = await screen.findByRole('button', { name: /^Ask/ });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(ask.querySelector('.silo-reader-dockmark')).toBeNull();
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
  expect(articlePrefs().pencil.style).toBe('highlighter');
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
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Speed' }), { key: 'End' });
  expect(
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Increase speed' }) as HTMLButtonElement;
      if (!button.disabled) throw new Error('still enabled');
      return button.disabled;
    }),
  ).toBe(true);
});

it('hides Ask when Librarian is not ready', async () => {
  renderContent(undefined, prose);
  await screen.findByText('Body text');
  expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
});
it('leaves the Highlight and Notes tools out for a feed post', async () => {
  renderContent(makeLink({ id: 'dock', feedId: 'feed-1' }), prose);
  await screen.findByText('Body text');
  await screen.findByRole('toolbar', { name: 'Reader tools' });
  expect(document.querySelector('[data-tool="highlight"]')).toBeNull();
  expect(document.querySelector('[data-tool="notes"]')).toBeNull();
  expect(document.querySelector('[data-tool="type"]')).not.toBeNull();
});

it('keeps the Highlight and Notes tools for a library link with highlight data', async () => {
  renderContent(makeLink({ id: 'dock', highlights: [] }), prose);
  await screen.findByText('Body text');
  await screen.findByRole('toolbar', { name: 'Reader tools' });
  expect(document.querySelector('[data-tool="highlight"]')).not.toBeNull();
  expect(document.querySelector('[data-tool="notes"]')).not.toBeNull();
});

it('opens Ask, focuses its input and restores tools and focus on fold', async () => {
  renderContent(undefined, prose, true);
  // Ask waits for the AI status query, and the chat chunk loads lazily on first open.
  fireEvent.click(await screen.findByRole('button', { name: 'Ask' }, { timeout: 5000 }));
  const input = await screen.findByRole(
    'textbox',
    { name: 'Ask the Librarian' },
    { timeout: 5000 },
  );
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.keyDown(document, { key: 'Escape' });
  const ask = await screen.findByRole('button', { name: 'Ask' });
  await waitFor(() => expect(document.activeElement).toBe(ask));
  expect(screen.queryByRole('textbox', { name: 'Ask the Librarian' })).toBeNull();
});

it('prepares the chat while idle without taking focus, then reuses it through open and fold', async () => {
  let prepare: IdleRequestCallback | undefined;
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    prepare = callback;
    return 1;
  });
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  renderContent(makeLink({ id: 'prepared-dock' }), prose, true);
  const ask = await screen.findByRole('button', { name: 'Ask' });
  await waitFor(() => expect(prepare).toBeDefined());
  act(() => prepare?.({ didTimeout: false, timeRemaining: () => 50 }));
  const field = await waitFor(() => {
    const input = document.querySelector('textarea[aria-label="Ask the Librarian"]');
    expect(input).not.toBeNull();
    return input;
  });
  expect(screen.queryByRole('textbox', { name: 'Ask the Librarian' })).toBeNull();
  expect(document.activeElement).not.toBe(field);
  fireEvent.click(ask);
  expect(await screen.findByRole('textbox', { name: 'Ask the Librarian' })).toBe(field);
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.click(screen.getByRole('button', { name: 'Fold chat' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ask' })),
  );
  expect(document.querySelector('textarea[aria-label="Ask the Librarian"]')).toBe(field);
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByRole('textbox', { name: 'Ask the Librarian' })).toBe(field);
});

it('folds on an outside press, retains the chat, and returns focus only from inside it', async () => {
  renderContent(makeLink({ id: 'outside-focus' }), prose, true);
  const ask = await screen.findByRole('button', { name: 'Ask' });
  fireEvent.click(ask);
  const input = await screen.findByRole('textbox', { name: 'Ask the Librarian' });
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent(document.body, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  expect(screen.getByRole('button', { name: 'Ask' })).toBe(ask);
  expect(document.activeElement).toBe(ask);
  expect(document.querySelector('textarea[aria-label="Ask the Librarian"]')).toBe(input);
  fireEvent.click(ask);
  await waitFor(() => expect(document.activeElement).toBe(input));
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  fireEvent(outside, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  expect(document.activeElement).toBe(outside);
  expect(screen.getByRole('button', { name: 'Ask' })).toBe(ask);
  outside.remove();
});

it.each(['Type', 'Ask'])('clears only article selections when opening %s', async (name) => {
  renderContent(makeLink({ id: `selection-${name}` }), prose, true);
  const body = await screen.findByText('Body text');
  const button = await screen.findByRole('button', { name });
  const selection = window.getSelection();
  if (!selection) throw new Error('Selection API missing');
  const range = document.createRange();
  range.selectNodeContents(body);
  selection?.removeAllRanges();
  selection.addRange(range);
  const clear = vi.spyOn(selection, 'removeAllRanges');
  fireEvent.click(button);
  expect(clear).toHaveBeenCalled();
  expect(selection.toString()).toBe('');
  clear.mockRestore();
});

it('leaves a selection outside the article alone when a sheet opens', async () => {
  renderContent(undefined, prose);
  const button = await screen.findByRole('button', { name: 'Type' });
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(button);
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.click(button);
  expect(selection?.rangeCount).toBe(1);
  selection?.removeAllRanges();
});

const historyLinks = [makeLink({ id: 'dock' }), makeLink({ id: 'next' })];

function HistoryReader() {
  const { pathname } = useLocation();
  const nav = useReaderNavigation({
    links: historyLinks,
    loading: false,
    hasNextPage: false,
    fetchNextPage: undefined,
  });
  const link = historyLinks.find((link) => link.id === nav.selectedId);
  return (
    <>
      <output data-testid="article">{pathname === '/' ? (nav.selectedId ?? 'list') : 'tag'}</output>
      <Link to="/tags/test">Tag</Link>
      <button type="button" onClick={() => void nav.step(1)}>
        Next article
      </button>
      {pathname === '/' && link && (
        <Host>
          <TestArticlePrefs key={link.id} link={link}>
            <ReaderContent link={link} />
          </TestArticlePrefs>
        </Host>
      )}
    </>
  );
}

function renderHistoryReader() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/api/ai')
        ? json({ status: { features: { librarian: { ready: true } } } })
        : String(input).includes('/librarian/chats?')
          ? json({ chats: [], nextCursor: null })
          : String(input).endsWith('/reader')
            ? json(prose)
            : json({ error: 'not_found', message: 'none' }, 404),
    ),
  );
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BrowserRouter>
        <HoverPreviewProvider>
          <HistoryReader />
        </HoverPreviewProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

async function travel(direction: 'back' | 'forward') {
  await act(async () => {
    const arrived = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    window.history[direction]();
    await arrived;
  });
}

it('folds the real Ask on Back, keeps the article URL, then leaves on a second Back', async () => {
  renderHistoryReader();
  fireEvent.click(await screen.findByRole('button', { name: 'Ask' }));
  await screen.findByRole('textbox', { name: 'Ask the Librarian' });
  await travel('back');
  expect(screen.queryByRole('textbox', { name: 'Ask the Librarian' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Ask' })).toBeDefined();
  expect(window.location.search).toBe('?link=dock');
  await travel('back');
  expect(screen.getByTestId('article').textContent).toBe('list');
});

it('switches real tool sheets without adding or replacing their history entry', async () => {
  renderHistoryReader();
  fireEvent.click(await screen.findByRole('button', { name: 'Type' }));
  const length = window.history.length;
  const token = window.history.state.siloDock;
  fireEvent.click(screen.getByRole('button', { name: 'Pencil settings' }));
  expect(await screen.findByRole('dialog', { name: 'Pencil' })).toBeDefined();
  expect(window.history.length).toBe(length);
  expect(window.history.state.siloDock).toBe(token);
  await travel('back');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(window.location.search).toBe('?link=dock');
});

it('closes the real Ask before opening the next article', async () => {
  renderHistoryReader();
  fireEvent.click(await screen.findByRole('button', { name: 'Ask' }));
  await screen.findByRole('textbox', { name: 'Ask the Librarian' });
  fireEvent.click(screen.getByRole('button', { name: 'Next article' }));
  await waitFor(() => expect(screen.getByTestId('article').textContent).toBe('next'));
  expect(window.location.search).toBe('?link=next');
  expect(screen.queryByRole('textbox', { name: 'Ask the Librarian' })).toBeNull();
  expect(window.history.state.siloDock).toBeUndefined();
  await travel('back');
  expect(screen.getByTestId('article').textContent).toBe('dock');
});

it('returns from a terminal orphan on Forward so one Back still leaves the article', async () => {
  renderHistoryReader();
  fireEvent.click(await screen.findByRole('button', { name: 'Ask' }));
  await screen.findByRole('textbox', { name: 'Ask the Librarian' });
  await travel('back');
  await travel('forward');
  expect(window.history.state.siloDock).toBeUndefined();
  expect(window.location.search).toBe('?link=dock');
  expect(screen.queryByRole('textbox', { name: 'Ask the Librarian' })).toBeNull();
  await travel('back');
  expect(screen.getByTestId('article').textContent).toBe('list');
});

it('skips an orphan beneath a router link in both directions', async () => {
  renderHistoryReader();
  fireEvent.click(await screen.findByRole('button', { name: 'Type' }));
  fireEvent.click(screen.getByRole('link', { name: 'Tag' }));
  expect(screen.getByTestId('article').textContent).toBe('tag');
  await travel('back');
  expect(window.history.state.siloDock).toBeUndefined();
  expect(window.location.search).toBe('?link=dock');
  expect(screen.getByTestId('article').textContent).toBe('dock');
  await travel('forward');
  expect(window.location.pathname).toBe('/tags/test');
  expect(screen.getByTestId('article').textContent).toBe('tag');
  await travel('back');
  await travel('back');
  expect(screen.getByTestId('article').textContent).toBe('list');
});

it('closes the real Notes lane and Ask together on Back', async () => {
  renderContent(
    makeLink({
      id: 'dock',
      highlights: [
        {
          id: 'orphan',
          quote: 'Missing passage',
          prefix: '',
          suffix: '',
          startOffset: 0,
          endOffset: 15,
          color: 'yellow',
          note: 'Saved note',
          createdAt: '',
          updatedAt: '',
        },
      ],
    }),
    prose,
    true,
  );
  const notes = await screen.findByRole('button', { name: /^Notes/ });
  fireEvent.click(notes);
  expect(notes.getAttribute('aria-pressed')).toBe('true');
  const token = window.history.state.siloDock;
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await screen.findByRole('textbox', { name: 'Ask the Librarian' });
  expect(window.history.state.siloDock).toBe(token);
  await travel('back');
  expect(screen.queryByRole('textbox', { name: 'Ask the Librarian' })).toBeNull();
  expect(notes.getAttribute('aria-pressed')).toBe('false');
  expect(window.location.search).toBe('?link=dock');
});
