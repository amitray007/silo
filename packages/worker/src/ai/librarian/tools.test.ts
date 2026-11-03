import { describe, expect, it, vi } from 'vitest';
import { librarianTools } from './tools.js';

describe('Librarian tools', () => {
  it('allows reads, forwards cancellation, caps output, and reports tool errors', async () => {
    const call = vi.fn().mockResolvedValue({ text: 'x'.repeat(25000), isError: false });
    const tools = await librarianTools({
      list: async () =>
        ['get_link', 'hard_delete_link'].map((name) => ({
          name,
          description: name,
          inputSchema: { type: 'object' },
        })),
      call,
    });
    expect(Object.keys(tools)).toEqual(['get_link']);
    const execute = tools.get_link?.execute;
    if (!execute) throw new Error('missing tool');
    const signal = new AbortController().signal;
    const output = await execute(
      { id: 'link' },
      { context: {}, toolCallId: 'test', messages: [], abortSignal: signal },
    );
    expect(output).toContain('Output truncated');
    expect(output).toHaveLength(24000);
    expect(call).toHaveBeenCalledWith('get_link', { id: 'link' }, signal);
    call.mockResolvedValue({
      text: 'full text: 32 chars (see structuredContent.extractedText)',
      structured: { extractedText: 'Hard work compounds over decades.' },
      isError: false,
    });
    const withBody = await execute(
      { id: 'link' },
      { context: {}, toolCallId: 'test', messages: [] },
    );
    expect(withBody).toContain('Hard work compounds over decades.');
    call.mockResolvedValue({ text: 'Link missing', isError: true });
    await expect(execute({}, { context: {}, toolCallId: 'test', messages: [] })).rejects.toThrow(
      'Link missing',
    );
  });
});

it('exposes every source tool except export and gates destructive tools on the secret', async () => {
  const names = [
    'capture_link',
    'trash_link',
    'hard_delete_link',
    'delete_tag',
    'delete_highlight',
    'unsubscribe_feed',
    'export_links',
  ];
  const source = {
    list: async () =>
      names.map((name) => ({ name, description: name, inputSchema: { type: 'object' } })),
    call: vi.fn(),
  };
  expect(Object.keys(await librarianTools(source))).toEqual(['capture_link']);
  expect(Object.keys(await librarianTools(source, new Uint8Array(32)))).toEqual(names.slice(0, -1));
  expect(source.call).not.toHaveBeenCalled();
});

it('quick actions expose only read-only tools even when approval secrets are available', async () => {
  const source = {
    list: async () =>
      ['get_link', 'search_links', 'find_related', 'capture_link', 'trash_link'].map((name) => ({
        name,
        description: name,
        inputSchema: { type: 'object' },
      })),
    call: vi.fn(),
  };
  expect(Object.keys(await librarianTools(source, new Uint8Array(32), true))).toEqual([
    'get_link',
    'search_links',
    'find_related',
  ]);
});

it.each([
  ['edit_link', { note: '' }],
  ['edit_highlight', { note: null }],
  ['rename_tag', { merge: true }],
] as const)('blocks protected %s calls when the secret is missing', async (name, input) => {
  const call = vi.fn();
  const tools = await librarianTools({
    list: async () => [{ name, description: name, inputSchema: { type: 'object' } }],
    call,
  });
  await expect(
    tools[name]?.execute?.(input, { context: {}, toolCallId: 'c', messages: [] }),
  ).rejects.toThrow('Approval is unavailable');
  expect(call).not.toHaveBeenCalled();
});
