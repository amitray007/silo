import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLibrarianChat } from './useLibrarianChat';

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
afterEach(() => vi.unstubAllGlobals());
function setup(link: string, deleted?: Promise<void>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        await deleted;
        return json({});
      }
      const url = String(input);
      if (url.includes('?')) return json({ chats: [{ id: 'a', title: 'A' }], nextCursor: null });
      const id = url.split('/').at(-1);
      return json({
        chat: { id, title: id },
        messages: [
          { id: `saved-${id}`, role: 'user', parts: [{ type: 'text', text: `Saved ${id}` }] },
        ],
      });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return renderHook(() => useLibrarianChat(link), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
it('reloads saved messages after older chats leave the recent cache', async () => {
  const { result } = setup('eviction-test');
  await waitFor(() => expect(result.current.loading).toBe(false));
  const original = result.current.messages;
  for (let i = 0; i < 12; i++) {
    act(() => result.current.open(`chat-${i}`));
    await waitFor(() => expect(result.current.loading).toBe(false));
  }
  act(() => result.current.open('a'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.messages).toEqual(original);
  expect(result.current.messages).not.toBe(original);
});
it('preserves a selection made while deletion is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { result } = setup('delete-race-test', pending);
  await waitFor(() => expect(result.current.loading).toBe(false));
  let deletion!: Promise<void>;
  act(() => {
    deletion = result.current.deleteChat('a', 'c');
  });
  act(() => result.current.open('b'));
  await act(async () => {
    finish();
    await deletion;
  });
  expect(result.current.chatId).toBe('b');
});

it('keeps an in-flight chat beyond the recent cache limit', async () => {
  const { result } = setup('stream-cache-test');
  await waitFor(() => expect(result.current.loading).toBe(false));
  const fetcher = vi.mocked(fetch);
  const normal = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetcher.mockImplementation((input, init) =>
    String(input).endsWith('/messages')
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : normal(input, init),
  );
  let sending!: Promise<void>;
  act(() => {
    sending = result.current.send('Keep answering');
  });
  await waitFor(() => expect(result.current.status).toBe('submitted'));
  const messages = result.current.messages;
  for (let i = 0; i < 12; i++) {
    act(() => result.current.open(`other-${i}`));
    await waitFor(() => expect(result.current.loading).toBe(false));
  }
  act(() => result.current.open('a'));
  expect(result.current.status).toBe('submitted');
  expect(result.current.messages).toBe(messages);
  await act(async () => {
    finish(
      new Response('data: [DONE]\n\n', {
        headers: {
          'Content-Type': 'text/event-stream',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
      }),
    );
    await sending;
  });
});
