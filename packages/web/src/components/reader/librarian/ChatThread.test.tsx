import type { UIMessage } from '@ai-sdk/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChatThread, type Composer } from './ChatThread';
import type { ThreadChat } from './useLibrarianChat';

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
