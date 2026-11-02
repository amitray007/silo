import type { UIMessage } from '@ai-sdk/react';
import { expect, it } from 'vitest';
import { statusLabel } from './status';

const assistant = (parts: UIMessage['parts']): UIMessage => ({ id: 'a', role: 'assistant', parts });
const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] };

it('says Thinking before the assistant has written anything', () => {
  expect(statusLabel([user])).toBe('Thinking…');
  expect(statusLabel([user, assistant([])])).toBe('Thinking…');
});

it('names the tool that is running', () => {
  const running = (toolName: string) =>
    assistant([
      { type: `tool-${toolName}`, toolCallId: 'c', state: 'input-available', input: {} },
    ] as UIMessage['parts']);
  expect(statusLabel([user, running('get_link')])).toBe('Reading the article…');
  expect(statusLabel([user, running('list_highlights')])).toBe('Reading your notes…');
  expect(statusLabel([user, running('search_links')])).toBe('Searching your library…');
  expect(statusLabel([user, running('capture_link')])).toBe('Working…');
});

it('says Answering once text follows the last tool call, not for thinking aloud before it', () => {
  const done = {
    type: 'tool-get_link',
    toolCallId: 'c',
    state: 'output-available',
    input: {},
    output: {},
  };
  expect(
    statusLabel([
      user,
      assistant([{ type: 'text', text: 'Let me read it.' }, done] as UIMessage['parts']),
    ]),
  ).toBe('Thinking…');
  expect(
    statusLabel([user, assistant([done, { type: 'text', text: 'It says' }] as UIMessage['parts'])]),
  ).toBe('Answering…');
});
