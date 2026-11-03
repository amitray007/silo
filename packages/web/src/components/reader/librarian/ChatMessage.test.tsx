import type { UIMessage } from '@ai-sdk/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
