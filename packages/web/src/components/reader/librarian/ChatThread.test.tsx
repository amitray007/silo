import type { UIMessage } from '@ai-sdk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as renderPlain, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
import { ChatThread, type Composer } from './ChatThread';
import { type ThreadChat, useLibrarianPageChat } from './useLibrarianChat';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const render = (ui: ReactElement) =>
  renderPlain(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });

const text = (id: string, role: 'user' | 'assistant', body: string): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text: body }],
});

function fakeChat(over: Partial<ThreadChat> = {}): ThreadChat {
  return {
    messages: [text('u', 'user', 'Hi'), text('a', 'assistant', 'Hello there')],
    busy: false,
    loading: false,
    pendingApproval: false,
    failed: false,
    errorText: '',
    send: vi.fn(),
    stop: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    ...over,
  } as unknown as ThreadChat;
}

const composer = (input = ''): Composer =>
  ({
    input,
    setInput: vi.fn(),
    passage: undefined,
    setPassage: vi.fn(),
    field: { current: null },
  }) as Composer;

function mount(chat: ThreadChat, input = '') {
  return render(
    <ChatThread
      chat={chat}
      composer={composer(input)}
      actions={[]}
      emptyText="Empty"
      header={null}
    />,
  );
}

it('shows a muted Send until there is text, and the status while the answer is running', () => {
  mount(fakeChat());
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('status')).toBeNull();
});

it('swaps Send for Stop while streaming, and Stop stops the stream', () => {
  const chat = fakeChat({ busy: true });
  mount(chat, 'next question');
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(chat.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toBe('Answering…');
});

it('offers Jump to latest after the reader scrolls up, and returns to the end on click', () => {
  const chat = fakeChat();
  const view = mount(chat);
  const log = screen.getByRole('log', { name: 'Messages' });
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 300 },
  });
  log.scrollTop = 0;
  fireEvent.scroll(log);
  expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();
  // New text arriving while away raises the pill and leaves the reader where they are.
  view.rerender(
    <ChatThread
      chat={fakeChat({ messages: [...chat.messages, text('b', 'assistant', 'More')], busy: true })}
      composer={composer()}
      actions={[]}
      emptyText="Empty"
      header={null}
    />,
  );
  expect(log.scrollTop).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
  expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
});

it('keeps following the end while the reader has not scrolled away', () => {
  const chat = fakeChat();
  const view = mount(chat);
  const log = screen.getByRole('log', { name: 'Messages' });
  Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 900 });
  view.rerender(
    <ChatThread
      chat={fakeChat({ messages: [...chat.messages, text('b', 'assistant', 'More')], busy: true })}
      composer={composer()}
      actions={[]}
      emptyText="Empty"
      header={null}
    />,
  );
  expect(log.scrollTop).toBe(900);
  expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
});

const search = (state: 'input-available' | 'output-available'): UIMessage['parts'][number] =>
  ({
    type: 'tool-search_links',
    toolCallId: 'c',
    state,
    input: {},
    ...(state === 'output-available' && { output: { links: [{ id: '1' }, { id: '2' }] } }),
  }) as UIMessage['parts'][number];
const streaming = (part: UIMessage['parts'][number]) =>
  fakeChat({
    busy: true,
    messages: [text('u', 'user', 'Related?'), { id: 'a', role: 'assistant', parts: [part] }],
  });

it('shows only the running status while a step runs, and only its trace once it finishes', () => {
  const view = mount(streaming(search('input-available')), 'x');
  expect(screen.getByRole('status').textContent).toBe('Searching your library…');
  expect(document.querySelector('.silo-chat-trace')).toBeNull();
  view.rerender(
    <ChatThread
      chat={streaming(search('output-available'))}
      composer={composer('x')}
      actions={[]}
      emptyText="Empty"
      header={null}
    />,
  );
  // The finished step's label drifts out (aria-hidden) while the status moves on to the next.
  expect(document.querySelector('.silo-status-in')?.textContent).toBe('Thinking…');
  expect(document.querySelector('.silo-chat-trace')?.textContent).toBe(
    'Searched your library · 2 links',
  );
});

it('holds back a trace phrase while another call of the same step is running', () => {
  const chat = fakeChat({
    busy: true,
    messages: [
      text('u', 'user', 'Related?'),
      {
        id: 'a',
        role: 'assistant',
        parts: [search('output-available'), search('input-available')],
      },
    ],
  });
  mount(chat, 'x');
  expect(screen.getByRole('status').textContent).toBe('Searching your library…');
  expect(document.querySelector('.silo-chat-trace')).toBeNull();
});

it('puts the quick actions, the passage and Stop inside the one composer surface', () => {
  const chat = fakeChat({ busy: true, messages: [] });
  const { container } = render(
    <ChatThread
      chat={chat}
      composer={{ ...composer(), passage: { quote: 'A passage', paragraph: 1 } }}
      actions={[['related', 'Related']]}
      emptyText="Empty"
      header={null}
    />,
  );
  const form = container.querySelector('form.silo-composer') as HTMLFormElement;
  expect(form.querySelector('.silo-chat-passage')?.textContent).toBe('A passage');
  for (const name of ['Explain', 'Simplify', 'Counterpoint', 'Stop'])
    expect(form.contains(screen.getByRole('button', { name }))).toBe(true);
  expect(form.querySelector('[data-mode="stop"] i')).not.toBeNull();
});

it('keeps the empty chat quick actions in the composer, not beside the log', () => {
  const { container } = render(
    <ChatThread
      chat={fakeChat({ messages: [] })}
      composer={composer()}
      actions={[['related', 'Related']]}
      emptyText="Empty"
      header={null}
      variant="page"
    />,
  );
  const related = screen.getByRole('button', { name: 'Related' });
  expect(container.querySelector('.silo-composer-quick')?.contains(related)).toBe(true);
});

it.each([false, true])('uses the motion preference when jumping: reduced=%s', (reduced) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduced })),
  );
  mount(fakeChat());
  const log = screen.getByRole('log', { name: 'Messages' });
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 300 },
  });
  log.scrollTo = vi.fn();
  log.scrollTop = 0;
  fireEvent.scroll(log);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
  expect(log.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: reduced ? 'auto' : 'smooth' });
  vi.unstubAllGlobals();
});

it('does not scroll a folded chat and restores its pinned end when it reopens', () => {
  const chat = fakeChat();
  const view = mount(chat);
  const log = screen.getByRole('log', { name: 'Messages' });
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 300 },
  });
  log.scrollTop = 700;
  fireEvent.scroll(log);
  const compose = composer();
  const renderThread = (active: boolean, messages = chat.messages) => (
    <ChatThread
      active={active}
      chat={{ ...chat, messages }}
      composer={compose}
      actions={[]}
      emptyText="Empty"
      header={null}
    />
  );
  view.rerender(renderThread(false));
  Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1300 });
  const messages = [...chat.messages, text('last', 'assistant', 'New text while folded')];
  view.rerender(renderThread(false, messages));
  expect(log.scrollTop).toBe(700);
  view.rerender(renderThread(true, messages));
  expect(log.scrollTop).toBe(1300);
});

it('sends a custom chip by id with its label as the turn text', () => {
  const chat = fakeChat({ messages: [] });
  render(
    <ChatThread
      chat={chat}
      composer={composer()}
      actions={[
        ['summary', 'Summarize'],
        ['custom:abc', 'Plain words'],
      ]}
      emptyText="Empty"
      header={null}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Plain words' }));
  expect(chat.send).toHaveBeenCalledWith('Plain words', 'custom:abc', undefined);
});

it('sends the Library chip id, and a custom Library chip its own id', () => {
  const chat = fakeChat({ messages: [] });
  render(
    <ChatThread
      chat={chat}
      composer={composer()}
      actions={[
        ['week', 'Saved this week'],
        ['highlights', 'Recent highlights'],
        ['custom:lib', 'Reading list'],
      ]}
      emptyText="Empty"
      header={null}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Saved this week' }));
  expect(chat.send).toHaveBeenLastCalledWith('Saved this week', 'week', undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Reading list' }));
  expect(chat.send).toHaveBeenLastCalledWith('Reading list', 'custom:lib', undefined);
});

it('reads the passage chips from the owner setting', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            librarianActions: {
              passage: [
                { id: 'explain', hidden: true },
                { id: 'custom:abc', label: 'Plain words', prompt: 'p' },
              ],
              article: [],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
  render(
    <ChatThread
      chat={fakeChat({ messages: [] })}
      composer={{ ...composer(), passage: { quote: 'a long enough phrase', paragraph: 1 } }}
      actions={[]}
      emptyText="Empty"
      header={null}
    />,
  );
  expect(await screen.findByRole('button', { name: 'Plain words' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull();
  vi.unstubAllGlobals();
});

it('shows the removed-action line for an unknown_action failure', async () => {
  const { chatErrorText } = await import('./useLibrarianChat');
  expect(chatErrorText('{"error":"unknown_action"}')).toBe(
    'This action was removed. Pick another.',
  );
});

it('announces the stored conversation loading with a spinner, then shows the empty text', () => {
  const { rerender } = mount(fakeChat({ messages: [], loading: true }));
  expect(screen.getByRole('status').textContent).toBe('Loading conversation');
  expect(screen.queryByText('Empty')).toBeNull();
  rerender(
    <ChatThread
      chat={fakeChat({ messages: [], loading: false })}
      composer={composer()}
      actions={[]}
      emptyText="Empty"
      header={null}
    />,
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('Empty')).toBeDefined();
});

it('ends the conversation spinner and shows the error after a detail fetch fails', async () => {
  let fail: (response: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          fail = resolve;
        }),
    ),
  );
  function Conversation() {
    const chat = useLibrarianPageChat('failed-initial-detail', () => {});
    return (
      <ChatThread chat={chat} composer={composer()} actions={[]} emptyText="Empty" header={null} />
    );
  }
  try {
    render(<Conversation />);
    expect(screen.getByRole('status').textContent).toBe('Loading conversation');
    await act(async () => {
      fail(
        new Response(JSON.stringify({ error: 'unavailable', message: 'Unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Could not answer. Try again.');
    expect(screen.queryByRole('status')).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

function answerSettings(chatAnswers: 'streamed' | 'complete') {
  client.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ chatAnswers }))),
  );
}

it('with Show answers on completion, the running answer stays unrendered until the turn ends', async () => {
  answerSettings('complete');
  const running = fakeChat({
    busy: true,
    messages: [text('u', 'user', 'Why?'), text('a', 'assistant', 'Half an ans')],
  });
  const view = mount(running);
  await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
  await vi.waitFor(() => expect(screen.queryByText(/Half an ans/)).toBeNull());
  expect(screen.getByRole('status').textContent).toBe('Answering…');
  view.rerender(
    <QueryClientProvider client={client}>
      <ChatThread
        chat={fakeChat({
          messages: [text('u', 'user', 'Why?'), text('a', 'assistant', 'A whole answer.')],
        })}
        composer={composer()}
        actions={[]}
        emptyText="Empty"
        header={null}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText('A whole answer.')).toBeTruthy();
  client.clear();
  vi.unstubAllGlobals();
});

it('streams the running answer by default', async () => {
  answerSettings('streamed');
  mount(
    fakeChat({
      busy: true,
      messages: [text('u', 'user', 'Why?'), text('a', 'assistant', 'Half an ans')],
    }),
  );
  expect(screen.getByText(/Half an ans/)).toBeTruthy();
  client.clear();
  vi.unstubAllGlobals();
});
