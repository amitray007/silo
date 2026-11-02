import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DockChat } from './DockChat';

type Stored = { id: string; title: string; updatedAt: string; messages: string[] };
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const sse = (chunks: object[]) =>
  `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
const streamHeaders = {
  'Content-Type': 'text/event-stream',
  'x-vercel-ai-ui-message-stream': 'v1',
};
const answer = (id: string, text: string) => [
  { type: 'start', messageId: id },
  { type: 'text-start', id: `${id}-t` },
  { type: 'text-delta', id: `${id}-t`, delta: text },
  { type: 'text-end', id: `${id}-t` },
  { type: 'finish' },
];

/** Chat `n` was last used `n` minutes ago, so a higher number is older. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const stored = (n: number, messages = [`Question ${n}`]): Stored => ({
  id: `chat-${n}`,
  title: `Chat ${n}`,
  updatedAt: minutesAgo(n),
  messages,
});

class FakeObserver {
  static all: FakeObserver[] = [];
  constructor(
    private callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    FakeObserver.all.push(this);
  }
  target: Element | null = null;
  disconnected = false;
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
/** Scroll the open menu to the sentinel at its end. */
function scrollToEnd() {
  const live = FakeObserver.all.filter(
    (observer) => !observer.disconnected && observer.target?.matches('.silo-chat-history-end'),
  );
  act(() => live.at(-1)?.reachEnd());
}

const withMeta = (chat: Stored) => ({ ...chat, linkId: 'x', createdAt: '' });
function listPage(chats: Stored[], params: URLSearchParams) {
  const size = Number(params.get('limit'));
  const from = Number(params.get('cursor') ?? 0);
  return json({
    chats: chats.slice(from, from + size).map(withMeta),
    nextCursor: from + size < chats.length ? String(from + size) : null,
  });
}
const detail = (chat: Stored) =>
  json({
    chat: withMeta(chat),
    messages: chat.messages.map((text, index) => ({
      id: `${chat.id}-m${index}`,
      role: index % 2 ? 'assistant' : 'user',
      parts: [{ type: 'text', text }],
    })),
  });
/** A reply that stays open until `release` is called with its text. */
function heldReply(): { response: Response; release: (text: string) => void } {
  const encoder = new TextEncoder();
  let release = (_text: string) => {};
  const body = new ReadableStream({
    start(controller) {
      release = (text) => {
        controller.enqueue(encoder.encode(sse(answer('held', text))));
        controller.close();
      };
    },
  });
  return {
    response: new Response(body, { headers: streamHeaders }),
    release: (text) => release(text),
  };
}

let sequence = 0;
/** An in-memory Librarian API: cursor pages, detail, create, delete and a stream that can be held. */
function setup(initial: Stored[], options: { hold?: boolean } = {}) {
  const chats = [...initial];
  const deleted: string[] = [];
  const listUrls: string[] = [];
  const held = heldReply();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://silo.test');
    const id = url.pathname.split('/')[4];
    if (url.pathname.endsWith('/messages'))
      return options.hold
        ? held.response
        : new Response(sse(answer('reply', 'Fresh answer')), { headers: streamHeaders });
    if (init?.method === 'DELETE') {
      deleted.push(id ?? '');
      chats.splice(
        chats.findIndex((chat) => chat.id === id),
        1,
      );
      return new Response(null, { status: 204 });
    }
    if (init?.method === 'POST') {
      const created = { id: 'chat-new', title: 'New chat', updatedAt: minutesAgo(0), messages: [] };
      chats.unshift(created);
      return json(withMeta(created));
    }
    if (url.pathname === '/api/librarian/chats') {
      listUrls.push(url.search);
      return listPage(chats, url.searchParams);
    }
    const chat = chats.find((item) => item.id === id);
    return chat ? detail(chat) : json({ error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetcher);
  const fold = vi.fn();
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DockChat linkId={`history-${++sequence}`} onFold={fold} />
    </QueryClientProvider>,
  );
  return { fetcher, fold, deleted, listUrls, view, release: held.release };
}
const openMenu = async () => {
  fireEvent.click(document.querySelector<HTMLElement>('.silo-chat-title') as HTMLElement);
  return screen.findByRole('dialog', { name: 'Chat history' });
};
const rowTitles = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.silo-chat-history-title')?.textContent)
    .filter(Boolean);

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

it('lists the chats newest first with their ages, and loads the next page at the end', async () => {
  const chats = Array.from({ length: 25 }, (_, index) => stored(index + 1));
  const { listUrls } = setup(chats);
  await screen.findByText('Question 1');
  const menu = await openMenu();
  await waitFor(() => expect(rowTitles(menu)).toHaveLength(20));
  expect(rowTitles(menu)?.slice(0, 3)).toEqual(['Chat 1', 'Chat 2', 'Chat 3']);
  expect(within(menu).getAllByText('3m ago')).toHaveLength(1);
  expect(listUrls.at(-1)).toContain('limit=20');
  expect(listUrls.at(-1)).not.toContain('cursor');
  scrollToEnd();
  await waitFor(() => expect(rowTitles(menu)).toHaveLength(25));
  expect(listUrls.at(-1)).toContain('cursor=20');
  expect(rowTitles(menu)?.at(-1)).toBe('Chat 25');
  expect(FakeObserver.all.filter((observer) => !observer.disconnected)).toHaveLength(0);
});

it('opens the chosen chat with its stored messages', async () => {
  setup([stored(1), stored(2, ['Older question', 'Older answer'])]);
  await screen.findByText('Question 1');
  const menu = await openMenu();
  fireEvent.click(await within(menu).findByRole('button', { name: /^Chat 2/ }));
  await screen.findByText('Older answer');
  expect(screen.queryByText('Question 1')).toBeNull();
  expect(document.querySelector('.silo-chat-title')?.textContent).toBe('Chat 2');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chat history' })).toBeNull());
  expect(document.activeElement).toBe(document.querySelector('.silo-chat-title'));
});

it('starts an empty chat with the plus and creates its row on the first send', async () => {
  const { fetcher } = setup([stored(1)]);
  await screen.findByText('Question 1');
  fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
  await waitFor(() => expect(screen.queryByText('Question 1')).toBeNull());
  expect(screen.getByRole('button', { name: 'Summarize' })).toBeTruthy();
  expect(document.querySelector('.silo-chat-title')?.textContent).toBe('New chat');
  const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));
  await screen.findByText('Fresh answer');
  expect(posts().map(([url]) => String(url))).toEqual([
    '/api/librarian/chats',
    '/api/librarian/chats/chat-new/messages',
  ]);
});

it('asks in the row, keeps the chat on Cancel and removes it on Delete', async () => {
  const { deleted } = setup([stored(1), stored(2), stored(3)]);
  await screen.findByText('Question 1');
  const menu = await openMenu();
  fireEvent.click(await within(menu).findByRole('button', { name: 'Delete chat: Chat 3' }));
  expect(within(menu).getByText('Delete this chat?')).toBeTruthy();
  fireEvent.click(within(menu).getByRole('button', { name: 'Cancel' }));
  expect(rowTitles(menu)).toEqual(['Chat 1', 'Chat 2', 'Chat 3']);
  expect(deleted).toEqual([]);
  fireEvent.click(within(menu).getByRole('button', { name: 'Delete chat: Chat 3' }));
  fireEvent.click(within(menu).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(rowTitles(menu)).toEqual(['Chat 1', 'Chat 2']));
  expect(deleted).toEqual(['chat-3']);
  expect(screen.getByText('Question 1')).toBeTruthy();
});

it('shows the next chat when the open one is deleted, then an empty chat when none is left', async () => {
  setup([stored(1), stored(2, ['Second question'])]);
  await screen.findByText('Question 1');
  let menu = await openMenu();
  fireEvent.click(await within(menu).findByRole('button', { name: 'Delete chat: Chat 1' }));
  fireEvent.click(within(menu).getByRole('button', { name: 'Delete' }));
  await screen.findByText('Second question');
  expect(screen.queryByText('Question 1')).toBeNull();
  menu = screen.getByRole('dialog', { name: 'Chat history' });
  fireEvent.click(within(menu).getByRole('button', { name: 'Delete chat: Chat 2' }));
  fireEvent.click(within(menu).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByText('Second question')).toBeNull());
  expect(screen.getByRole('button', { name: 'Summarize' })).toBeTruthy();
  expect(document.querySelector('.silo-chat-title')?.textContent).toBe('New chat');
});

it('moves with arrow keys, asks to delete with Delete and closes the menu before the chat', async () => {
  const { fold } = setup([stored(1), stored(2, ['Older question'])]);
  await screen.findByText('Question 1');
  const menu = await openMenu();
  const first = await within(menu).findByRole('button', { name: /^Chat 1/ });
  await waitFor(() => expect(document.activeElement).toBe(first));
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  const second = within(menu).getByRole('button', { name: /^Chat 2/ });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chat history' })).toBeNull());
  expect(fold).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(document.querySelector('.silo-chat-title'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(fold).toHaveBeenCalledTimes(1);

  const again = await openMenu();
  const target = await within(again).findByRole('button', { name: /^Chat 2/ });
  target.focus();
  fireEvent.keyDown(target, { key: 'Delete' });
  expect(within(again).getByText('Delete this chat?')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(within(again).queryByText('Delete this chat?')).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Chat history' })).toBeTruthy();
  expect(fold).toHaveBeenCalledTimes(1);
});

it('keeps a streaming answer out of the chat you switch to, and shows it when you return', async () => {
  const { release } = setup([stored(1, ['Hello', 'Hi there']), stored(2, ['Other question'])], {
    hold: true,
  });
  await screen.findByText('Hi there');
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the Librarian' }), {
    target: { value: 'Question while away' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Question while away');

  const menu = await openMenu();
  fireEvent.click(await within(menu).findByRole('button', { name: /^Chat 2/ }));
  await screen.findByText('Other question');
  expect(screen.queryByText('Question while away')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the Librarian' }), {
    target: { value: 'Free to ask here' },
  });
  expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false);

  await act(async () => release('Answer that arrived late'));
  expect(screen.queryByText('Answer that arrived late')).toBeNull();
  expect(screen.getByText('Other question')).toBeTruthy();

  const back = await openMenu();
  fireEvent.click(await within(back).findByRole('button', { name: /^Chat 1/ }));
  await screen.findByText('Answer that arrived late');
  expect(screen.queryByText('Other question')).toBeNull();
});
