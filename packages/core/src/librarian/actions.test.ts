import { describe, expect, it } from 'vitest';
import { parseSettingValue, parseStoredSettingValue } from '../settings/schema.js';
import { LIBRARIAN_ACTIONS_DEFAULTS } from './actions.js';

const custom = {
  id: 'custom:00000000-0000-4000-8000-000000000001',
  label: ' Ask ',
  prompt: ' Do this ',
};
const defaults = () => structuredClone(LIBRARIAN_ACTIONS_DEFAULTS);
describe('Librarian action settings', () => {
  it('defaults to every built-in in the existing order, visible and without custom actions', () => {
    expect(defaults()).toEqual({
      passage: ['explain', 'simplify', 'counterpoint', 'define', 'context', 'related'].map(
        (id) => ({ id, hidden: false }),
      ),
      article: ['summary', 'claims', 'my-notes', 'related'].map((id) => ({ id, hidden: false })),
    });
  });
  it('trims labels and prompts and preserves ordering and hidden choices', () => {
    const value = defaults();
    value.passage.reverse();
    value.passage = value.passage.map((entry) => ({ ...entry, hidden: true }));
    value.passage.push(custom);
    const parsed = parseSettingValue('librarianActions', value);
    expect(parsed.passage.at(-1)).toEqual({ ...custom, label: 'Ask', prompt: 'Do this' });
    expect(parsed.passage[0]).toEqual({ id: 'related', hidden: true });
  });
  it('appends a missing stored built-in visible without accepting that write', () => {
    const value = defaults();
    value.passage = value.passage.filter((entry) => entry.id !== 'explain');
    value.article = value.article.filter((entry) => entry.id !== 'summary');
    expect(() => parseSettingValue('librarianActions', value)).toThrow();
    const parsed = parseStoredSettingValue('librarianActions', value);
    expect(parsed.passage.at(-1)).toEqual({ id: 'explain', hidden: false });
    expect(parsed.article.at(-1)).toEqual({ id: 'summary', hidden: false });
  });
  it('accepts six customs when built-ins are hidden and the exact text bounds', () => {
    const value = defaults();
    for (const list of [value.passage, value.article]) {
      for (const entry of list) if ('hidden' in entry) entry.hidden = true;
      list.push(
        ...Array.from({ length: 6 }, (_, n) => ({
          ...custom,
          id: `custom:00000000-0000-4000-8000-00000000000${n}`,
          label: 'x'.repeat(24),
          prompt: 'x'.repeat(1000),
        })),
      );
    }
    expect(parseSettingValue('librarianActions', value)).toEqual(value);
  });
});
