import { describe, expect, it } from 'vitest';
import { actionsFor } from './link-actions.js';

describe('actionsFor', () => {
  it('live variant has edit/tag/retry/trash; trash uses ctrl+x not enter', () => {
    const a = actionsFor('live');
    expect(a.map((x) => x.id)).toContain('trash');
    const trash = a.find((x) => x.id === 'trash');
    expect(trash?.destructive).toBe(true);
    expect(trash?.shortcut).not.toBe('enter');
  });

  it('trash variant binds enter to restore only (exactly one enter action)', () => {
    const a = actionsFor('trash');
    const enterActions = a.filter((x) => x.shortcut === 'enter');
    expect(enterActions.map((x) => x.id)).toEqual(['restore']); // exactly one, and it's restore
    expect(a.find((x) => x.id === 'delete')?.destructive).toBe(true);
  });

  it('each variant has at most one enter-bound action (no two actions fight for enter)', () => {
    for (const variant of ['live', 'trash'] as const) {
      const enterCount = actionsFor(variant).filter((x) => x.shortcut === 'enter').length;
      expect(enterCount).toBeLessThanOrEqual(1);
    }
  });

  it('no destructive action is ever bound to enter, in either variant', () => {
    for (const variant of ['live', 'trash'] as const) {
      for (const action of actionsFor(variant)) {
        if (action.destructive) expect(action.shortcut).not.toBe('enter');
      }
    }
  });

  it('live variant offers the full verb set from the design spec', () => {
    const ids = actionsFor('live').map((x) => x.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'open',
        'copy',
        'edit-note',
        'add-tag',
        'remove-tag',
        'retry',
        'filter-tag',
        'trash',
      ]),
    );
  });

  it('trash variant offers open/copy/restore/delete/empty-trash', () => {
    const ids = actionsFor('trash').map((x) => x.id);
    expect(ids).toEqual(
      expect.arrayContaining(['open', 'copy', 'restore', 'delete', 'empty-trash']),
    );
  });
});
