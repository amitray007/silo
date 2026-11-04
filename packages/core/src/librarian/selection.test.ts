import { expect, it } from 'vitest';
import { answerVersionSchema, importMessagesSchema, quickRequestSchema } from './types.js';

const quote = { quote: 'A passage', paragraph: 2, action: 'explain' };
it('validates the quick request without accepting unsupported actions or oversized selections', () => {
  const input = { linkId: '00000000-0000-4000-8000-000000000001', ...quote };
  expect(quickRequestSchema.safeParse(input).success).toBe(true);
  for (const change of [
    { quote: '' },
    { quote: 'x'.repeat(2001) },
    { paragraph: -1 },
    { paragraph: 1.5 },
    { action: 'delete' },
  ])
    expect(quickRequestSchema.safeParse({ ...input, ...change }).success).toBe(false);
});
it('imports only an ordered text turn with selection metadata and a bounded answer', () => {
  const user = {
    id: 'u',
    role: 'user',
    parts: [{ type: 'text', text: 'Explain' }],
    metadata: quote,
  };
  const assistant = { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] };
  expect(importMessagesSchema.safeParse({ messages: [user, assistant] }).success).toBe(true);
  for (const messages of [
    [assistant, user],
    [user, { ...assistant, parts: [{ type: 'tool-delete' }] }],
    [
      user,
      {
        ...assistant,
        parts: [
          { type: 'text', text: 'x'.repeat(10001) },
          { type: 'text', text: 'x'.repeat(10000) },
        ],
      },
    ],
    [{ ...user, metadata: {} }, assistant],
  ])
    expect(importMessagesSchema.safeParse({ messages }).success).toBe(false);
});

it('bounds snapshots by UTF-8 bytes at one million bytes', () => {
  const part = { type: 'text', text: '' };
  const snapshot = { id: 'v', parts: [part], metadata: {} };
  const overhead = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  part.text =
    'é'.repeat(Math.floor((1000000 - overhead) / 2)) + 'x'.repeat((1000000 - overhead) % 2);
  expect(new TextEncoder().encode(JSON.stringify(snapshot))).toHaveLength(1000000);
  expect(answerVersionSchema.safeParse(snapshot).success).toBe(true);
  part.text += 'é';
  expect(answerVersionSchema.safeParse(snapshot).success).toBe(false);
});
