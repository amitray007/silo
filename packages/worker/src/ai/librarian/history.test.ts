import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { stubOldToolResults } from './history.js';

const article = 'Hard work compounds. '.repeat(500);

function turn(id: string): ModelMessage[] {
  return [
    { role: 'user', content: 'Summarize this article.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: id, toolName: 'get_link', input: { id: 'l1' } }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: id,
          toolName: 'get_link',
          output: { type: 'text', value: article },
        },
      ],
    },
    { role: 'assistant', content: 'It argues that hard work compounds.' },
  ];
}

describe('stubOldToolResults', () => {
  it('replaces an earlier turn’s article with a stub and keeps the call', () => {
    const messages = [...turn('c1'), { role: 'user', content: 'And the counterpoint?' } as const];
    const result = stubOldToolResults(messages);
    const tool = result[2];
    if (tool?.role !== 'tool') throw new Error('expected the tool message');
    const part = tool.content[0];
    expect(part?.type === 'tool-result' && part.output).toEqual({
      type: 'text',
      value: expect.stringContaining('Earlier get_link result omitted'),
    });
    expect(result[1]).toEqual(messages[1]);
    expect(JSON.stringify(result)).not.toContain('Hard work compounds. Hard work');
  });

  it('keeps the two most recent messages whole', () => {
    const messages = turn('c2').slice(1, 3);
    expect(stubOldToolResults(messages)).toEqual(messages);
  });
});
