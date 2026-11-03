import type { UIMessage } from '@ai-sdk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessage } from './ChatMessage';

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

  it('says the answer came from the conversation when no tool ran', () => {
    const message: UIMessage = {
      id: 'a3',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello.' }],
    };
    render(<ChatMessage message={message} />);
    expect(screen.getByText('Answered from the conversation')).toBeTruthy();
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
