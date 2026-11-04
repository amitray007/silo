import type { UIMessage } from '@ai-sdk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';

vi.mock('../listen/voiceModels', () => ({ useVoiceModel: () => ({ phase: 'absent' }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Part = UIMessage['parts'][number];
const tool = (name: string, state: string, output?: unknown, id = name): Part =>
  ({
    type: 'dynamic-tool',
    toolName: name,
    toolCallId: id,
    state,
    input: {},
    ...(output !== undefined && { output }),
  }) as Part;
const message = (...parts: Part[]): UIMessage => ({ id: 'a', role: 'assistant', parts });
const open = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));
const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
);

it.each([
  ['search_links', 'Searching your library'],
  ['get_link', 'Reading the article'],
  ['list_highlights', 'Reading your notes'],
  ['trash_link', 'Working'],
])('names a running %s as one shimmering line with no disclosure', (name, label) => {
  const { container } = render(<ChatMessage message={message(tool(name, 'input-available'))} />);
  expect(container.querySelector('.silo-shimmer')?.textContent).toBe(label);
  expect(screen.queryByRole('button', { name: /^Used/ })).toBeNull();
});

it('summarises finished tools with a chevron button and no seconds for a stored message', () => {
  render(
    <ChatMessage
      message={message(
        tool('search_links', 'output-available', { count: 1 }),
        tool('get_link', 'output-available', {}),
        tool('list_highlights', 'output-available', 'ok'),
      )}
    />,
  );
  const head = screen.getByRole('button', { name: 'Used 3 tools' });
  expect(head.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Read your notes')).toBeNull();
  fireEvent.click(head);
  expect(head.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Read your notes')).toBeTruthy();
});

it('shows the seconds a tool took when it ran while the message was on screen', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const running = message(tool('search_links', 'input-available'));
  const view = render(<ChatMessage message={running} streaming />);
  vi.setSystemTime(1_004_000);
  view.rerender(
    <ChatMessage message={message(tool('search_links', 'output-available', { count: 2 }))} />,
  );
  expect(screen.getByRole('button', { name: 'Used 1 tool · 4s' })).toBeTruthy();
});

it('folds parallel searches into one row, with titled reads and write traces in run order', () => {
  render(
    <ChatMessage
      message={message(
        tool('search_links', 'output-available', { count: 2 }, 's1'),
        tool('get_link', 'output-available', { id: 'x', title: 'Agents explained' }, 'r1'),
        tool('search_links', 'output-available', { count: 3 }, 's2'),
        tool('add_link_tag', 'output-available', 'ok', 't1'),
        tool('create_tag', 'output-available', 'ok', 't2'),
        tool('capture_link', 'output-available', 'ok', 'c1'),
      )}
    />,
  );
  open('Used 6 tools');
  const rows = [...document.querySelectorAll('.silo-steps-row')].map((row) => row.textContent);
  expect(rows).toEqual([
    'Searched your library5 links',
    'Read “Agents explained”',
    'Tagged',
    'Saved to your library',
  ]);
});

it('shows the first four hits as site pills and the rest as +N', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ link: { url: 'https://www.simonwillison.net/p' } })),
    ),
  );
  const results = Array.from({ length: 6 }, (_, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    title: `Hit ${index}`,
  }));
  render(
    wrap(<ChatMessage message={message(tool('search_links', 'output-available', { results }))} />),
  );
  open('Used 1 tool');
  await waitFor(() => expect(screen.getAllByText('simonwillison')).toHaveLength(4));
  expect(screen.getByText('+2')).toBeTruthy();
});

it('keeps the approval card for a pending call and "Not done." for a denied one', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatMessage
        message={message(tool('trash_link', 'output-denied', undefined, 'd'), {
          type: 'dynamic-tool',
          toolName: 'edit_link',
          toolCallId: 'e',
          state: 'approval-requested',
          input: { id: 'l' },
          approval: { id: 'ap' },
        } as Part)}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Not done.')).toBeTruthy();
  expect(screen.getByRole('group')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Used/ })).toBeNull();
});
