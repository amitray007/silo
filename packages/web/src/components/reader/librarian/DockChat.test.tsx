import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';
import { DockChat } from './DockChat';
import { requestDock } from './selectionStore';

const summary = {
  id: 'chat-1',
  title: 'Saved title',
  linkId: 'article-1',
  createdAt: '',
  updatedAt: '',
};
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
let linkSequence = 0;
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
      <DockChat linkId={`article-${++linkSequence}`} onFold={fold} />
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
  fireEvent.click(screen.getByRole('button', { name: 'Fold chat' }));
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

it('keeps a delayed answer alive across fold and reopen', async () => {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/messages'))
        return new Response(
          new ReadableStream({
            start(c) {
              controller = c;
            },
          }),
          {
            headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          },
        );
      return json({ chats: [summary], nextCursor: null, chat: summary, messages: [] });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (open: boolean) => (
    <QueryClientProvider client={client}>
      {open && <DockChat linkId="delayed-link" onFold={() => {}} />}
    </QueryClientProvider>
  );
  const rendered = render(view(true));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Summarize' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));
  await waitFor(() => expect(controller!).toBeTruthy());
  rendered.rerender(view(false));
  rendered.rerender(view(true));
  const chunks = [
    { type: 'start', messageId: 'delayed' },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'Survived folding' },
    { type: 'text-end', id: 't' },
    { type: 'finish' },
  ];
  controller!.enqueue(
    encoder.encode(
      `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
    ),
  );
  controller!.close();
  await screen.findByText('Survived folding');
});

it.each(['trash_link'])('resumes $name and refreshes its queries', async (name) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/messages')) {
      const chunks = [
        { type: 'start', messageId: 'approval-last' },
        { type: 'tool-output-available', toolCallId: 'trash-call', output: 'Moved' },
        { type: 'finish' },
      ];
      return new Response(
        `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
        {
          headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
        },
      );
    }
    if (url.startsWith('/api/links/'))
      return json({ link: { title: 'Target title', highlights: [] } });
    if (url.includes('?')) return json({ chats: [summary], nextCursor: null });
    return json({
      chat: summary,
      messages: [
        {
          id: 'approval-last',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: name,
              toolCallId: 'trash-call',
              state: 'approval-requested',
              input: { id: 'link' },
              approval: { id: 'approval-id', signature: 'signed' },
            },
          ],
        },
      ],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <QueryClientProvider client={client}>
      <DockChat linkId={`approval-integration-${name}`} onFold={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Allow' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the Librarian' }), {
    target: { value: 'Another question' },
  });
  expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Allow or deny first.')).toBeTruthy();
  const { act } = await import('@testing-library/react');
  const { requestDock } = await import('./selectionStore');
  act(() =>
    requestDock(`approval-integration-${name}`, {
      passage: { quote: 'A selected passage', paragraph: 2 },
      question: 'Why this passage?',
    }),
  );
  await screen.findByText('A selected passage');
  expect(
    (screen.getByRole('textbox', { name: 'Ask the Librarian' }) as HTMLTextAreaElement).value,
  ).toBe('Why this passage?');
  for (const label of ['Explain', 'Simplify', 'Counterpoint'])
    expect(screen.getByRole('button', { name: label }).hasAttribute('disabled')).toBe(true);
  fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form')!);
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tags'] }));
  if (name === 'refresh_reader')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['live-reader', 'link'] });
  else expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['live-reader', 'link'] });
  const request = fetcher.mock.calls.find(([url]) => String(url).endsWith('/messages'));
  const body = JSON.parse(String(request?.[1]?.body));
  expect(Object.keys(body)).toEqual(['message']);
  expect(body.message.role).toBe('assistant');
  expect(body.message.parts[0].approval).toEqual({
    id: 'approval-id',
    signature: 'signed',
    approved: true,
  });
  for (const key of ['links', 'link', 'counts'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
});

it('attaches a passage and carries it in the next sent message', async () => {
  const { act } = await import('@testing-library/react');
  const { requestDock } = await import('./selectionStore');
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/messages'))
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      });
    if (url.includes('?')) return json({ chats: [{ ...summary, id: 'attached-chat' }] });
    return json({ chat: { ...summary, id: 'attached-chat' }, messages: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DockChat linkId="attach-test" onFold={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByText('Ask about this article or your library.');
  act(() => requestDock('attach-test', { passage: { quote: 'Chosen passage', paragraph: 3 } }));
  await screen.findByText('Chosen passage');
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the Librarian' }), {
    target: { value: 'Why?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(true),
  );
  const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/messages'));
  expect(JSON.parse(String(request?.[1]?.body)).message.metadata).toEqual({
    quote: 'Chosen passage',
    paragraph: 3,
  });
  expect(screen.queryByText('Chosen passage')).toBeNull();
});

it('expires approvals in older assistant messages', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('?')) return json({ chats: [summary], nextCursor: null });
      return json({
        chat: summary,
        messages: [
          {
            id: 'old',
            role: 'assistant',
            parts: [
              {
                type: 'dynamic-tool',
                toolName: 'delete_tag',
                toolCallId: 'old-call',
                input: { name: 'old tag' },
                state: 'approval-requested',
                approval: { id: 'old-approval' },
              },
            ],
          },
          { id: 'latest', role: 'assistant', parts: [{ type: 'text', text: 'Latest answer' }] },
        ],
      });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DockChat linkId="expired-chat" onFold={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByText('Expired. Ask again.');
  expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask the Librarian' }), {
    target: { value: 'Ask again' },
  });
  expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false);
});

it('invalidates the refreshed link live Reader after a direct refresh finishes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/messages')) {
        const chunks = [
          { type: 'start', messageId: 'refreshed' },
          {
            type: 'tool-input-available',
            toolCallId: 'refresh',
            toolName: 'refresh_reader',
            input: { id: 'refreshed-link' },
            dynamic: true,
          },
          {
            type: 'tool-output-available',
            toolCallId: 'refresh',
            output: 'Refreshed',
            dynamic: true,
          },
          { type: 'finish' },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
          {
            headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          },
        );
      }
      if (init?.method === 'POST') return json(summary);
      return json({ chats: [], nextCursor: null });
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <DockChat linkId="refresh-direct-chat" onFold={() => {}} />
    </QueryClientProvider>,
  );
  const action = screen.getByRole('button', { name: 'Summarize' });
  await waitFor(() => expect(action.hasAttribute('disabled')).toBe(false));
  fireEvent.click(action);
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['live-reader', 'refreshed-link'] }),
  );
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['live-reader', 'refresh-direct-chat'] });
});

it('focuses an open dock when a passage arrives', async () => {
  setup();
  await screen.findByRole('textbox');
  screen.getByRole('button', { name: 'Back to tools' }).focus();
  requestDock(`article-${linkSequence}`, { passage: { quote: 'Attached passage', paragraph: 2 } });
  await screen.findByText('Attached passage');
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
});
