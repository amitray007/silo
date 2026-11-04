import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibrarianView } from './LibrarianView';

type Stored = {
  id: string;
  title: string;
  linkId: string | null;
  linkTitle: string | null;
  updatedAt: string;
  messages: string[];
};
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'x-vercel-ai-ui-message-stream': 'v1',
};
const reply = (text: string) =>
  `${[
    { type: 'start', messageId: `reply-${text}` },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish' },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('')}data: [DONE]\n\n`;

let ready = true;
vi.mock('../api/librarian', async (original) => ({
  ...(await original<typeof import('../api/librarian')>()),
  useLibrarianReady: () => ready,
}));
let run = 0;
/** Chat ids are unique per test: open chats stay cached across renders in one file. */
const stored = (n: number, extra: Partial<Stored> = {}): Stored => ({
  id: `run${run}-chat-${n}`,
  title: `Chat ${n}`,
  linkId: `article-${n}`,
  linkTitle: `Article ${n}`,
  updatedAt: new Date(Date.now() - n * 60_000).toISOString(),
  messages: [`Question ${n}`, `Answer ${n}`],
  ...extra,
});
const summary = (chat: Stored) => ({
  id: chat.id,
  title: chat.title,
  linkId: chat.linkId,
  linkTitle: chat.linkTitle,
  createdAt: chat.updatedAt,
  updatedAt: chat.updatedAt,
});

class FakeObserver {
  static all: FakeObserver[] = [];
  target: Element | null = null;
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  reachEnd() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
  }
}
const scrollToEnd = () =>
  act(() =>
    FakeObserver.all
      .filter((observer) => !observer.disconnected)
      .at(-1)
      ?.reachEnd(),
  );

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

/** An in-memory Librarian API. */
function setup(initial: Stored[], path = '/librarian', settings: unknown = {}) {
  const chats = [...initial];
  const calls: { method: string; url: string; body: unknown }[] = [];
  const serve = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://silo.test');
    const method = init?.method ?? 'GET';
    calls.push({ method, url: url.pathname + url.search, body: init?.body });
    const id = url.pathname.split('/')[4];
    if (url.pathname.endsWith('/messages'))
      return new Response(reply('Fresh answer'), { headers: streamHeaders });
    if (method === 'DELETE') {
      chats.splice(
        chats.findIndex((chat) => chat.id === id),
        1,
      );
      return new Response(null, { status: 204 });
    }
    if (method === 'POST') {
      const created = stored(0, {
        id: `run${run}-created`,
        title: 'New chat',
        linkId: null,
        linkTitle: null,
        messages: [],
        updatedAt: new Date().toISOString(),
      });
      chats.unshift(created);
      return json(summary(created));
    }
    if (url.pathname === '/api/librarian/chats') {
      const size = Number(url.searchParams.get('limit'));
      const from = Number(url.searchParams.get('cursor') ?? 0);
      return json({
        chats: chats.slice(from, from + size).map(summary),
        nextCursor: from + size < chats.length ? String(from + size) : null,
      });
    }
    const chat = chats.find((item) => item.id === id);
    return chat
      ? json({
          chat: summary(chat),
          messages: chat.messages.map((text, index) => ({
            id: `${chat.id}-m${index}`,
            role: index % 2 ? 'assistant' : 'user',
            parts: [{ type: 'text', text }],
          })),
        })
      : new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  };
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith('/api/settings') ? json(settings) : serve(input, init),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <LibrarianView />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { calls, chats };
}
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-chat-pick]'));
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  ready = true;
  run += 1;
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('lists every chat newest first with its article or "Library", and its age', async () => {
  setup([
    stored(1),
    stored(2, { linkId: null, linkTitle: null, title: 'Reading list ideas' }),
    stored(3, { linkTitle: null }),
  ]);
  await screen.findByText('Chat 1');
  expect(rows().map((row) => row.querySelector('.silo-row-title')?.textContent)).toEqual([
    'Chat 1',
    'Reading list ideas',
    'Chat 3',
  ]);
  const meta = rows().map((row) => row.querySelector('.silo-row-meta')?.textContent);
  expect(meta).toEqual(['Article 1·1m ago', 'Library·2m ago', 'Library·3m ago']);
  expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
});

it('loads pages of 20 as the list scrolls, with no upper limit', async () => {
  const { calls } = setup(Array.from({ length: 45 }, (_, index) => stored(index + 1)));
  await screen.findByText('Chat 1');
  await waitFor(() => expect(rows()).toHaveLength(20));
  expect(calls.filter((call) => call.url.startsWith('/api/librarian/chats?'))[0]?.url).toBe(
    '/api/librarian/chats?limit=20',
  );
  scrollToEnd();
  await waitFor(() => expect(rows()).toHaveLength(40));
  scrollToEnd();
  await waitFor(() => expect(rows()).toHaveLength(45));
  expect(rows().at(-1)?.textContent).toContain('Chat 45');
  expect(calls.at(-1)?.url).toContain('cursor=40');
});

it('shows the open chat with its messages, and an article chat links to the Reader', async () => {
  setup([stored(1), stored(2, { linkId: null, linkTitle: null })]);
  fireEvent.click(await screen.findByRole('button', { name: /^Chat 1/ }));
  await screen.findByText('Answer 1');
  expect(screen.getByText('Question 1')).toBeTruthy();
  expect(where()).toBe(`?chat=run${run}-chat-1`);
  const article = screen.getByRole('link', { name: 'Open article: Article 1' });
  expect(article.getAttribute('href')).toBe('/?link=article-1');
  expect(rows()[0]?.getAttribute('aria-current')).toBe('true');
  // A library chat has no article to open.
  fireEvent.click(screen.getByRole('button', { name: /^Chat 2/ }));
  await screen.findByText('Answer 2');
  expect(screen.queryByRole('link', { name: /Open article/ })).toBeNull();
});

it('starts a library chat with the plus: Library chips only, and no linkId on create', async () => {
  const { calls } = setup([stored(1)]);
  await screen.findByText('Chat 1');
  fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
  expect(where()).toBe('?chat=new');
  expect(await screen.findByRole('button', { name: 'Saved this week' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Recent highlights' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Related' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'My notes here' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the Librarian' }), {
    target: { value: 'What is in my library?' },
  });
  fireEvent.submit(
    screen.getByRole('textbox', { name: 'Ask the Librarian' }).closest('form') as HTMLFormElement,
  );
  await screen.findByText('Fresh answer');
  const create = calls.find((call) => call.method === 'POST' && !call.url.endsWith('/messages'));
  expect(create?.url).toBe('/api/librarian/chats');
  expect(JSON.parse(String(create?.body))).toEqual({});
  const sent = calls.find((call) => call.url.endsWith('/messages'));
  expect(sent?.url).toBe(`/api/librarian/chats/run${run}-created/messages`);
  await waitFor(() => expect(where()).toBe(`?chat=run${run}-created`));
  // The new chat joins the list as a library chat.
  await waitFor(() => expect(screen.getAllByText('Library').length).toBeGreaterThan(0));
});

const sentActions = (calls: { url: string; body: unknown }[]) => {
  const sent = calls.find((call) => call.url.endsWith('/messages'));
  const body = JSON.parse(String(sent?.body)) as {
    message: { metadata?: { action?: string } };
  };
  return body.message.metadata?.action;
};

it('sends week from the default Library chip in a new chat', async () => {
  const { calls } = setup([stored(1)], '/librarian?chat=new');
  fireEvent.click(await screen.findByRole('button', { name: 'Saved this week' }));
  await screen.findByText('Fresh answer');
  expect(sentActions(calls)).toBe('week');
});

it('shows the owner Library list and sends a custom chip id', async () => {
  const { calls } = setup([stored(1)], '/librarian?chat=new', {
    librarianActions: {
      passage: [],
      article: [],
      library: [
        { id: 'week', hidden: true },
        { id: 'highlights', hidden: false },
        { id: 'custom:lib1', label: 'Reading list', prompt: 'List my reading.' },
      ],
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Reading list' }));
  expect(screen.queryByRole('button', { name: 'Saved this week' })).toBeNull();
  await screen.findByText('Fresh answer');
  expect(sentActions(calls)).toBe('custom:lib1');
});

it('asks before deleting, cancels on Escape, and moves to the next chat when the open one goes', async () => {
  const { calls } = setup([stored(1), stored(2), stored(3)]);
  fireEvent.click(await screen.findByRole('button', { name: /^Chat 1/ }));
  await screen.findByText('Answer 1');
  fireEvent.click(screen.getByRole('button', { name: 'Delete chat: Chat 1' }));
  const ask = await screen.findByText('Delete this chat?');
  expect(document.activeElement?.textContent).toBe('Cancel');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByText('Delete this chat?')).toBeNull());
  expect(ask.isConnected).toBe(false);
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  // The Delete key asks again; confirming removes the chat and opens the next one.
  const first = rows()[0] as HTMLElement;
  first.focus();
  fireEvent.keyDown(first, { key: 'Delete' });
  fireEvent.click(
    await within(document.querySelector('.silo-chat-history-confirm') as HTMLElement).findByRole(
      'button',
      { name: 'Delete' },
    ),
  );
  await waitFor(() => expect(screen.queryByText('Chat 1')).toBeNull());
  expect(calls.find((call) => call.method === 'DELETE')?.url).toBe(
    `/api/librarian/chats/run${run}-chat-1`,
  );
  await waitFor(() => expect(where()).toBe(`?chat=run${run}-chat-2`));
  await screen.findByText('Answer 2');
});

it('falls back to the empty pane when the last chat is deleted', async () => {
  setup([stored(1)]);
  fireEvent.click(await screen.findByRole('button', { name: /^Chat 1/ }));
  await screen.findByText('Answer 1');
  fireEvent.click(screen.getByRole('button', { name: 'Delete chat: Chat 1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await screen.findByText('No chats yet');
  await waitFor(() => expect(where()).toBe(''));
  expect(screen.getByText('Select a chat')).toBeTruthy();
});

it('moves through the list with the arrow keys and opens with Enter', async () => {
  setup([stored(1), stored(2)]);
  await screen.findByText('Chat 1');
  const [one, two] = rows() as [HTMLElement, HTMLElement];
  one.focus();
  fireEvent.keyDown(one, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(two);
  fireEvent.keyDown(two, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(one);
});

it('says so when there are no chats', async () => {
  setup([]);
  await screen.findByText('No chats yet');
  expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
});

it('gates direct navigation when the Librarian is off', () => {
  ready = false;
  setup([]);
  expect(screen.getByRole('link', { name: 'Settings → AI' })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Chats' })).toBeNull();
});

it('keeps native text selection on the Librarian page without article selection controls', async () => {
  setup([stored(1)]);
  fireEvent.click(await screen.findByRole('button', { name: /^Chat 1/ }));
  const answer = await screen.findByText('Answer 1');
  const range = document.createRange();
  range.selectNodeContents(answer);
  act(() => {
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
  });
  expect(window.getSelection()?.toString()).toBe('Answer 1');
  expect(document.querySelector('.silo-reader-prose')).toBeNull();
  expect(document.querySelector('[data-selection-bar]')).toBeNull();
});
