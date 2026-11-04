import type { UIMessage } from '@ai-sdk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceModel } from '../listen/voiceModels';
import { ChatMessage } from './ChatMessage';

vi.mock('../listen/voiceModels', () => ({ useVoiceModel: vi.fn() }));

const voiceModel = (phase: 'absent' | 'downloaded') =>
  vi.mocked(useVoiceModel).mockReturnValue({ phase } as ReturnType<typeof useVoiceModel>);

beforeEach(() => {
  voiceModel('absent');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const reply = (text: string, id = 'a'): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }],
});

function search(id: string, count: number) {
  return {
    type: 'dynamic-tool',
    toolName: 'search_links',
    toolCallId: id,
    state: 'output-available',
    input: {},
    output: JSON.stringify({ count }),
  } as UIMessage['parts'][number];
}

describe('ChatMessage', () => {
  it('merges several library searches into one trace with the total count', () => {
    const message: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Let me search.' },
        search('s1', 15),
        search('s2', 0),
        search('s3', 2),
        { type: 'text', text: 'Two pieces match.' },
      ],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('Searched your library · 17 links')).toBeTruthy();
  });

  it('shows text written before a tool call as a muted step, apart from the answer', () => {
    const message: UIMessage = {
      id: 'a2',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Let me search.' },
        search('s1', 1),
        { type: 'text', text: 'One piece matches.' },
      ],
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.querySelector('.silo-chat-step')?.textContent).toBe('Let me search.');
    expect(screen.getByText('One piece matches.')).toBeTruthy();
  });

  it('shows no trace line when no tool ran', () => {
    const message: UIMessage = {
      id: 'a3',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello.' }],
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.querySelector('.silo-chat-trace')).toBeNull();
  });

  it('shows the passage quote under a user turn that carries one', () => {
    const message: UIMessage = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'Simplify' }],
      metadata: { action: 'simplify', quote: 'A dense passage.', paragraph: 3 },
    };
    const { container } = render(<ChatMessage message={message} />);
    expect(container.querySelector('.silo-chat-quote')?.textContent).toBe('A dense passage.');
  });
});

it('offers Allow and Deny for an approval and sends the matching decision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ link: { title: 'Named article' } }))),
  );
  const onApproval = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatMessage
        onApproval={onApproval}
        message={{
          id: 'approval',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'trash_link',
              toolCallId: 'call',
              state: 'approval-requested',
              input: { id: 'link' },
              approval: { id: 'approve' },
            },
          ],
        }}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('group', { name: 'Move “Named article” to trash?' })).toBeTruthy();
  expect(screen.queryByText('Answered from the conversation')).toBeNull();
  vi.unstubAllGlobals();
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(onApproval).toHaveBeenLastCalledWith({ id: 'approve', approved: true });
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
  expect(onApproval).toHaveBeenLastCalledWith({ id: 'approve', approved: false });
});
it('shows denied calls and successful write traces', () => {
  render(
    <ChatMessage
      message={{
        id: 'denied',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'trash_link',
            toolCallId: 'call',
            state: 'output-denied',
            input: {},
            approval: { id: 'a', approved: false },
          },
          {
            type: 'dynamic-tool',
            toolName: 'add_link_tag',
            toolCallId: 'tag',
            state: 'output-available',
            input: {},
            output: 'ok',
          },
        ],
      }}
    />,
  );
  expect(screen.getByText('Not done.')).toBeTruthy();
  expect(screen.getByText('Tagged')).toBeTruthy();
  expect(screen.queryByText('Moved to trash')).toBeNull();
});

const SAVED = '00000000-0000-4000-8000-000000000001';

async function renderCitations() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify({ link: { url: 'https://news.example.org/post' } })),
    ),
  );
  const { MemoryRouter } = await import('react-router');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ChatMessage message={reply(`[Saved](/?link=${SAVED}) [Web](https://www.example.com/a)`)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('opens saved-item citations through the router and keeps external links in a new tab', async () => {
  await renderCitations();
  const saved = await screen.findByRole('link', { name: 'Saved' });
  expect(saved.getAttribute('href')).toBe(`/?link=${SAVED}`);
  expect(saved.getAttribute('target')).toBeNull();
  expect(screen.getByRole('link', { name: 'Web' }).getAttribute('target')).toBe('_blank');
});

it('puts the site favicon before each link: its own host, or the cited link domain', async () => {
  await renderCitations();
  const web = await screen.findByRole('link', { name: 'Web' });
  expect(web.querySelector('img')?.getAttribute('src')).toBe('/api/favicon?domain=example.com');
  const saved = await screen.findByRole('link', { name: 'Saved' });
  await waitFor(() =>
    expect(saved.querySelector('img')?.getAttribute('src')).toBe(
      '/api/favicon?domain=news.example.org',
    ),
  );
});

it('keeps completed paragraphs and list numbering through streaming and completion', () => {
  const message: UIMessage = {
    id: 'stable-blocks',
    role: 'assistant',
    parts: [{ type: 'text', text: 'First paragraph.\n\n1. One' }],
  };
  const view = render(<ChatMessage message={message} streaming />);
  // Streaming wraps each word in its own span, so find the paragraph by element.
  const firstParagraph = () => view.container.querySelector('.silo-chat-answer p');
  const paragraph = firstParagraph();
  expect(paragraph?.textContent).toBe('First paragraph.');
  const longer: UIMessage = {
    ...message,
    parts: [{ type: 'text', text: 'First paragraph.\n\n1. One\n2. Two' }],
  };
  view.rerender(<ChatMessage message={longer} streaming />);
  expect(firstParagraph()).toBe(paragraph);
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['One', 'Two']);
  view.rerender(<ChatMessage message={longer} />);
  expect(firstParagraph()).toBe(paragraph);
  expect(screen.getAllByRole('list')).toHaveLength(1);
});

describe('chat look', () => {
  it('shows the owner turn as a bubble and the Librarian answer as plain text beside its tile', () => {
    const user = render(
      <ChatMessage message={{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Why?' }] }} />,
    );
    expect(user.container.querySelector('.silo-chat-user .silo-chat-bubble')?.textContent).toBe(
      'Why?',
    );
    user.unmount();
    const { container } = render(<ChatMessage message={reply('Because.')} />);
    expect(container.querySelector('.silo-chat-bubble')).toBeNull();
    expect(container.querySelector('.silo-chat-avatar svg')).toBeTruthy();
    expect(container.querySelector('.silo-chat-assistant-body')?.textContent).toContain('Because.');
  });

  it('keeps a passage quote inside the owner bubble', () => {
    const { container } = render(
      <ChatMessage
        message={{
          id: 'u',
          role: 'user',
          parts: [{ type: 'text', text: 'Explain' }],
          metadata: { quote: 'A passage.' },
        }}
      />,
    );
    expect(container.querySelector('.silo-chat-bubble .silo-chat-quote')?.textContent).toBe(
      'A passage.',
    );
  });

  it('copies the answer markdown and confirms with a check', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<ChatMessage message={reply('**Bold** answer.')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    expect(writeText).toHaveBeenCalledWith('**Bold** answer.');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('hides the actions while the answer streams or waits for an approval', () => {
    const view = render(<ChatMessage message={reply('Partial')} streaming />);
    expect(screen.queryByRole('button', { name: 'Copy answer' })).toBeNull();
    view.rerender(<ChatMessage message={reply('Partial')} />);
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeTruthy();
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ChatMessage
          message={{
            id: 'a',
            role: 'assistant',
            parts: [
              { type: 'text', text: 'Partial' },
              {
                type: 'dynamic-tool',
                toolName: 'trash_link',
                toolCallId: 'c',
                state: 'approval-requested',
                input: {},
                approval: { id: 'x' },
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Copy answer' })).toBeNull();
  });

  it('shows the read aloud button only when the chosen voice model is downloaded', () => {
    const view = render(<ChatMessage message={reply('Because it is so.')} />);
    expect(screen.queryByRole('button', { name: 'Read aloud' })).toBeNull();
    voiceModel('downloaded');
    view.rerender(<ChatMessage message={reply('Because it is so, and that is all.')} />);
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeTruthy();
  });

  it('holds a streaming answer back and shows it whole once the message finishes', () => {
    const view = render(<ChatMessage message={reply('Half an ans')} streaming held />);
    expect(screen.queryByText(/Half an ans/)).toBeNull();
    view.rerender(<ChatMessage message={reply('A whole answer.')} />);
    expect(screen.getByText('A whole answer.')).toBeTruthy();
    expect(document.querySelector('.silo-chat-answer')?.getAttribute('data-reveal')).toBe('true');
  });
});

const FAKE = 'b0a0c0de-0000-0000-0000-000000000000';
async function renderHealing(output?: unknown, results: { id: string; title: string }[] = []) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(FAKE)) return new Response('{}', { status: 404 });
    if (url.includes('/search?')) return new Response(JSON.stringify({ results }));
    return new Response(JSON.stringify({ link: { url: 'https://saved.example/post' } }));
  });
  vi.stubGlobal('fetch', fetcher);
  const { MemoryRouter } = await import('react-router');
  const message = reply(`[Title: subtitle](/?link=${FAKE})`);
  if (output !== undefined)
    message.parts.unshift({
      type: 'dynamic-tool',
      toolName: 'search_links',
      toolCallId: 's',
      state: 'output-available',
      input: {},
      output,
    });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ChatMessage message={message} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, fetcher };
}

it('heals a fake id from summary-prefixed tool JSON and uses the saved favicon', async () => {
  const { fetcher } = await renderHealing(
    `1 link: [ai]\n\nData (JSON):\n${JSON.stringify({ links: [{ id: SAVED, title: ' title ' }] })}`,
  );
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Title: subtitle' }).getAttribute('href')).toBe(
      `/?link=${SAVED}`,
    ),
  );
  const link = screen.getByRole('link', { name: 'Title: subtitle' });
  await waitFor(() => expect(link.querySelector('img')).toBeTruthy());
  expect(link.querySelector('img')?.getAttribute('src')).toBe('/api/favicon?domain=saved.example');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/search?'))).toBe(false);
});

it('heals a fake id from summary lines when the tool JSON was cut off', async () => {
  const { fetcher } = await renderHealing(
    `1 result for "t":\n- (rank 0.500) Title (id: ${SAVED}) — https://saved.example/post [ai]\n\nData (JSON):\n{"results":[{"id":`,
  );
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Title: subtitle' }).getAttribute('href')).toBe(
      `/?link=${SAVED}`,
    ),
  );
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/search?'))).toBe(false);
});

it('keeps a cited link when its lookup fails for another reason', async () => {
  const fetcher = vi.fn(async (input: string | URL | Request) =>
    String(input).includes('/search?')
      ? new Response(JSON.stringify({ results: [] }))
      : new Response('{}', { status: 500 }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { MemoryRouter } = await import('react-router');
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ChatMessage message={reply(`[Saved](/?link=${SAVED})`)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByRole('link', { name: 'Saved' }).getAttribute('href')).toBe(`/?link=${SAVED}`);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/search?'))).toBe(false);
});

it('drops the link when the matched item was deleted too', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  const { MemoryRouter } = await import('react-router');
  const message = reply(`[Title](/?link=${SAVED})`);
  message.parts.unshift({
    type: 'dynamic-tool',
    toolName: 'search_links',
    toolCallId: 's',
    state: 'output-available',
    input: {},
    output: `Data (JSON):\n${JSON.stringify({ results: [{ id: SAVED, title: 'Title' }] })}`,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ChatMessage message={message} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByRole('link')).toBeNull());
  expect(screen.getByText('Title')).toBeTruthy();
});

it('heals a fake id through library search', async () => {
  await renderHealing(undefined, [{ id: SAVED, title: 'Title' }]);
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Title: subtitle' }).getAttribute('href')).toBe(
      `/?link=${SAVED}`,
    ),
  );
});

it('retries library search with the title before a colon', async () => {
  const { fetcher } = await renderHealing(undefined, []);
  fetcher.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(FAKE)) return new Response('{}', { status: 404 });
    if (url.includes('/search?'))
      return new Response(
        JSON.stringify({
          results: url.includes('subtitle') ? [] : [{ id: SAVED, title: 'Title' }],
        }),
      );
    return new Response(JSON.stringify({ link: { url: 'https://saved.example/post' } }));
  });
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Title: subtitle' }).getAttribute('href')).toBe(
      `/?link=${SAVED}`,
    ),
  );
});

it.each([
  { results: [] },
  {
    results: [
      { id: SAVED, title: 'Title' },
      { id: 'other', title: 'Title' },
    ],
  },
])('leaves unresolved or ambiguous citations as plain text', async ({ results }) => {
  const { container, fetcher } = await renderHealing(undefined, results);
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/search?'))).toBe(true),
  );
  expect(screen.getByText('Title: subtitle')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  expect(container.querySelector('.silo-letter-chip')).toBeNull();
});

it('copies only the user text and flashes a check', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  render(
    <ChatMessage
      message={{
        id: 'user-copy',
        role: 'user',
        parts: [{ type: 'text', text: 'Explain this' }],
        metadata: { quote: 'Quoted passage' },
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
  expect(writeText).toHaveBeenCalledWith('Explain this');
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
});

describe('ChatMessage reasoning', () => {
  const thinking = (state: 'streaming' | 'done', metadata?: UIMessage['metadata']): UIMessage => ({
    id: 'r1',
    role: 'assistant',
    metadata,
    parts: [
      { type: 'reasoning', text: 'Weighing the two sources.', state },
      { type: 'text', text: 'Here is the answer.' },
    ],
  });

  it('shows a Thinking label and the live text while reasoning streams', () => {
    render(<ChatMessage message={thinking('streaming')} streaming />);
    expect(screen.getByText('Thinking').className).toContain('silo-shimmer');
    expect(screen.getByText('Weighing the two sources.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thought/ })).toBeNull();
  });

  it('shows the time as a disclosure that opens the full reasoning', () => {
    render(<ChatMessage message={thinking('done', { reasoningMs: 4200 })} />);
    const toggle = screen.getByRole('button', { name: 'Thought for 4s' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Weighing the two sources.')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Weighing the two sources.')).toBeTruthy();
  });

  it('says only "Thought" when no time was recorded', () => {
    render(<ChatMessage message={thinking('done')} />);
    expect(screen.getByRole('button', { name: 'Thought' })).toBeTruthy();
  });

  it('shows no reasoning block when the message has no reasoning text', () => {
    const empty: UIMessage = {
      ...reply('Plain answer.'),
      parts: [{ type: 'reasoning', text: ' ', state: 'done' }, ...reply('Plain answer.').parts],
    };
    render(<ChatMessage message={empty} />);
    expect(screen.queryByText(/Thought|Thinking/)).toBeNull();
    expect(screen.getByText('Plain answer.')).toBeTruthy();
  });

  it('keeps reasoning hidden while the answer is held', () => {
    render(<ChatMessage message={thinking('streaming')} streaming held />);
    expect(screen.queryByText('Thinking')).toBeNull();
    expect(screen.queryByText('Weighing the two sources.')).toBeNull();
  });
});
