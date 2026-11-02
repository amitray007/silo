import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';
import { DockChat } from './DockChat';

const summary = {
  id: 'chat-1',
  title: 'Saved title',
  linkId: 'article-1',
  createdAt: '',
  updatedAt: '',
};
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function setup(resume = false) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/messages')) {
      const chunks = [
        { type: 'start', messageId: 'answer-1' },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'A streamed answer.' },
        { type: 'text-end', id: 'text-1' },
        { type: 'finish' },
      ];
      return new Response(
        `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } },
      );
    }
    if (init?.method === 'POST') return json(summary);
    if (url.includes('?')) return json({ chats: resume ? [summary] : [], nextCursor: null });
    return json({
      chat: summary,
      messages: [
        { id: 'saved-1', role: 'user', parts: [{ type: 'text', text: 'Stored question' }] },
      ],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const fold = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DockChat linkId="article-1" onFold={fold} />
    </QueryClientProvider>,
  );
  return { fetcher, fold };
}
afterEach(() => vi.unstubAllGlobals());
it('focuses the composer, posts only the quick action message and renders the stream', async () => {
  const { fetcher } = setup();
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ask the Librarian' }));
  const summarize = screen.getByRole('button', { name: 'Summarize' });
  await waitFor(() => expect(summarize.hasAttribute('disabled')).toBe(false));
  fireEvent.click(summarize);
  await screen.findByText('A streamed answer.');
  const sent = fetcher.mock.calls.find(([url]) => String(url).endsWith('/messages'));
  expect(sent?.[0]).toBe('/api/librarian/chats/chat-1/messages');
  const body = JSON.parse(String(sent?.[1]?.body));
  expect(Object.keys(body)).toEqual(['message']);
  expect(body.message.metadata).toEqual({ action: 'summary' });
  expect(body.message.parts).toEqual([{ type: 'text', text: 'Summarize' }]);
  expect(new Headers(sent?.[1]?.headers).get('X-Silo-CSRF')).toBe('1');
});
it('resumes stored messages and folds with minus, grid and Escape', async () => {
  const { fold, fetcher } = setup(true);
  await screen.findByText('Stored question');
  expect(screen.getByText('Saved title')).toBeTruthy();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Fold back into the dock' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to tools' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(fold).toHaveBeenCalledTimes(3);
});
it('renders article and search traces from tool results', () => {
  render(
    <ChatMessage
      message={{
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'get_link',
            toolCallId: 'read',
            state: 'output-available',
            input: {},
            output: {},
          },
          {
            type: 'dynamic-tool',
            toolName: 'search_links',
            toolCallId: 'search',
            state: 'output-available',
            input: {},
            output: { links: [{ id: '1' }, { id: '2' }] },
          },
        ],
      }}
    />,
  );
  expect(screen.getByText('Read this article · Searched your library · 2 links')).toBeTruthy();
});
it('shows a fixed error without provider details', async () => {
  setup();
  vi.mocked(fetch).mockRejectedValue(new Error('secret provider detail'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Summarize' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('secret provider detail')).toBeNull();
});
