import { describe, expect, it } from 'vitest';
import {
  articleChips,
  chipLabel,
  defaultActions,
  listProblem,
  moveEntry,
  passageChips,
  resolveActions,
  validateCustom,
} from './librarianActions';

const custom = (n: number) => ({ id: `custom:${n}`, label: `Mine ${n}`, prompt: 'Do it' });

describe('resolveActions', () => {
  it('gives every built-in, visible and in order, when nothing is stored', () => {
    const actions = resolveActions(undefined);
    expect(passageChips(actions, false).map(([id]) => id)).toEqual([
      'explain',
      'simplify',
      'counterpoint',
    ]);
    expect(passageChips(actions, true).map(([id]) => id)).toEqual(['define', 'context', 'related']);
    expect(articleChips(actions).map(([, label]) => label)).toEqual([
      'Summarize',
      'Key claims',
      'My notes here',
      'Related',
    ]);
  });

  it('appends a built-in the stored value lacks, visible', () => {
    const actions = resolveActions({ article: [{ id: 'summary', hidden: true }] });
    expect(actions.article.map((entry) => entry.id)).toEqual([
      'summary',
      'claims',
      'my-notes',
      'related',
    ]);
    expect(articleChips(actions).map(([id]) => id)).toEqual(['claims', 'my-notes', 'related']);
  });
});

describe('chips', () => {
  it('drops a hidden built-in', () => {
    const actions = defaultActions();
    actions.passage = actions.passage.map((entry) =>
      entry.id === 'explain' ? { id: 'explain', hidden: true } : entry,
    );
    expect(passageChips(actions, false).map(([id]) => id)).toEqual(['simplify', 'counterpoint']);
  });

  it('shows a custom passage action for phrases and for words, after the built-ins', () => {
    const actions = defaultActions();
    actions.passage = [custom(1), ...actions.passage];
    expect(passageChips(actions, false).at(-1)).toEqual(['custom:1', 'Mine 1']);
    expect(passageChips(actions, true).at(-1)).toEqual(['custom:1', 'Mine 1']);
  });

  it('keeps article list order, custom actions included', () => {
    const actions = defaultActions();
    actions.article = [custom(1), ...actions.article];
    expect(articleChips(actions)[0]).toEqual(['custom:1', 'Mine 1']);
  });

  it('names an action from its id', () => {
    const actions = defaultActions();
    actions.article = [...actions.article, custom(2)];
    expect(chipLabel(actions, 'custom:2')).toBe('Mine 2');
    expect(chipLabel(actions, 'claims')).toBe('Key claims');
    expect(chipLabel(actions, 'custom:gone')).toBeUndefined();
  });
});

describe('limits', () => {
  it('checks label and prompt', () => {
    expect(validateCustom('', 'x').label).toMatch(/label/i);
    expect(validateCustom('a'.repeat(25), 'x').label).toMatch(/24/);
    expect(validateCustom('ok', '   ').prompt).toBeTruthy();
    expect(validateCustom('ok', 'p'.repeat(1001)).prompt).toMatch(/1000/);
    expect(validateCustom('a'.repeat(24), 'p'.repeat(1000))).toEqual({});
  });

  it('refuses a set that would show more than six chips', () => {
    const actions = defaultActions();
    const four = [1, 2, 3, 4].map(custom);
    expect(listProblem('passage', [...actions.passage, ...four])).toMatch(/phrases/);
    const hidden = actions.passage.map((entry) =>
      ['explain', 'define'].includes(entry.id) ? { id: entry.id, hidden: true } : entry,
    );
    expect(listProblem('passage', [...hidden, ...four])).toBeNull();
    expect(listProblem('article', [...actions.article, custom(1), custom(2), custom(3)])).toMatch(
      /at most 6/i,
    );
  });

  it('refuses a seventh custom action', () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map(custom);
    const hidden = defaultActions().article.map((entry) => ({ id: entry.id, hidden: true }));
    expect(listProblem('article', [...hidden, ...many])).toMatch(/at most 6 custom/i);
  });
});

it('moves an entry and stops at the ends', () => {
  const list = [custom(1), custom(2), custom(3)];
  expect(moveEntry(list, 'custom:2', -1).map((entry) => entry.id)).toEqual([
    'custom:2',
    'custom:1',
    'custom:3',
  ]);
  expect(moveEntry(list, 'custom:1', -1).map((entry) => entry.id)).toEqual([
    'custom:1',
    'custom:2',
    'custom:3',
  ]);
});
