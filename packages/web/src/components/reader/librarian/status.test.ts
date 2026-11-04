import type { UIMessage } from '@ai-sdk/react';
import { expect, it } from 'vitest';
import { statusLabel } from './status';

const assistant = (parts: UIMessage['parts']): UIMessage => ({ id: 'a', role: 'assistant', parts });
const user: UIMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] };

it('says Thinking before the assistant has written anything', () => {
  expect(statusLabel([user])).toBe('Thinking…');
  expect(statusLabel([user, assistant([])])).toBe('Thinking…');
});

it('stays silent while a tool runs: the steps line in the message names it', () => {
  const running = assistant([
    { type: 'tool-search_links', toolCallId: 'c', state: 'input-available', input: {} },
  ] as UIMessage['parts']);
  expect(statusLabel([user, running])).toBeNull();
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
