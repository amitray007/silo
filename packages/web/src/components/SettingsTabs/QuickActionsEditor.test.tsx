import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultActions, type LibrarianActions } from '../../lib/librarianActions';
import { QuickActionsEditor } from './QuickActionsEditor';

afterEach(cleanup);

function mount(initial: LibrarianActions = defaultActions()) {
  const saved: LibrarianActions[] = [];
  function Host() {
    const [actions, setActions] = useState(initial);
    return (
      <QuickActionsEditor
        actions={actions}
        save={(next) => {
          saved.push(next);
          setActions(next);
        }}
      />
    );
  }
  render(<Host />);
  return saved;
}
const passage = () =>
  screen
    .getByRole('region', { name: 'Quick actions' })
    .querySelector('[data-list="passage"]') as HTMLElement;
const article = () =>
  screen
    .getByRole('region', { name: 'Quick actions' })
    .querySelector('[data-list="article"]') as HTMLElement;

function addAction(list: HTMLElement, label: string, prompt: string) {
  fireEvent.click(within(list).getByRole('button', { name: /^Add .* action$/ }));
  fireEvent.change(within(list).getByLabelText('Label'), { target: { value: label } });
  fireEvent.change(within(list).getByLabelText('Prompt'), { target: { value: prompt } });
  fireEvent.click(within(list).getByRole('button', { name: 'Save' }));
}

describe('built-in actions', () => {
  it('hides and shows a built-in, saving the whole value each time', () => {
    const saved = mount();
    fireEvent.click(within(passage()).getByRole('button', { name: 'Hide Explain' }));
    expect(saved.at(-1)?.passage[0]).toEqual({ id: 'explain', hidden: true });
    expect(saved.at(-1)?.article).toHaveLength(4);
    fireEvent.click(within(passage()).getByRole('button', { name: 'Show Explain' }));
    expect(saved.at(-1)?.passage[0]).toEqual({ id: 'explain', hidden: false });
  });

  it('has no delete or edit control for a built-in', () => {
    mount();
    expect(screen.queryByRole('button', { name: /^Delete Explain/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit Explain/ })).toBeNull();
  });
});

describe('custom actions', () => {
  it('adds one with its label and prompt preview', async () => {
    const saved = mount();
    addAction(article(), 'Plain words', 'Rewrite this in plain words.');
    const entry = saved.at(-1)?.article.at(-1);
    expect(entry).toMatchObject({ label: 'Plain words', prompt: 'Rewrite this in plain words.' });
    expect(entry?.id).toMatch(/^custom:[0-9a-f-]{36}$/);
    expect(within(article()).getByText('Rewrite this in plain words.')).toBeTruthy();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(within(article()).getByRole('button', { name: /^Add/ })),
    );
  });

  it('blocks save with a message for an empty label, a long label and a long prompt', () => {
    const saved = mount();
    fireEvent.click(within(article()).getByRole('button', { name: /^Add/ }));
    fireEvent.click(within(article()).getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Give the action a label.')).toBeTruthy();
    expect(screen.getByText('Write the prompt the Librarian should follow.')).toBeTruthy();
    fireEvent.change(within(article()).getByLabelText('Label'), {
      target: { value: 'x'.repeat(25) },
    });
    fireEvent.change(within(article()).getByLabelText('Prompt'), {
      target: { value: 'y'.repeat(1001) },
    });
    expect(screen.getByText('Keep the label to 24 characters.')).toBeTruthy();
    expect(screen.getByText('Keep the prompt to 1000 characters.')).toBeTruthy();
    expect(screen.getByText('1001/1000')).toBeTruthy();
    fireEvent.click(within(article()).getByRole('button', { name: 'Save' }));
    expect(saved).toHaveLength(0);
  });

  it('edits a custom action in place', async () => {
    const saved = mount();
    addAction(article(), 'Plain words', 'One.');
    fireEvent.click(within(article()).getByRole('button', { name: 'Edit Plain words' }));
    fireEvent.change(within(article()).getByLabelText('Label'), { target: { value: 'Simple' } });
    fireEvent.click(within(article()).getByRole('button', { name: 'Save' }));
    expect(saved.at(-1)?.article.at(-1)).toMatchObject({ label: 'Simple', prompt: 'One.' });
    expect(saved.at(-1)?.article).toHaveLength(5);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(article()).getByRole('button', { name: 'Edit Simple' }),
      ),
    );
  });

  it('deletes after an inline confirm, and Cancel keeps it', async () => {
    const saved = mount();
    addAction(article(), 'Plain words', 'One.');
    const before = saved.length;
    fireEvent.click(within(article()).getByRole('button', { name: 'Delete Plain words' }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(article()).getByRole('button', { name: 'Cancel' }),
      ),
    );
    fireEvent.click(within(article()).getByRole('button', { name: 'Cancel' }));
    expect(saved).toHaveLength(before);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(article()).getByRole('button', { name: 'Delete Plain words' }),
      ),
    );
    fireEvent.click(within(article()).getByRole('button', { name: 'Delete Plain words' }));
    fireEvent.click(within(article()).getByRole('button', { name: 'Delete' }));
    expect(saved.at(-1)?.article).toHaveLength(4);
    expect(within(article()).queryByText('Plain words')).toBeNull();
  });

  it('refuses a hide that undoes a limit, and a seventh custom action', () => {
    const saved = mount();
    for (let n = 1; n <= 3; n++) addAction(passage(), `Mine ${n}`, 'p');
    // Three built-ins plus three custom is six; a fourth would be seven chips.
    fireEvent.click(within(passage()).getByRole('button', { name: /^Add/ }));
    fireEvent.change(within(passage()).getByLabelText('Label'), { target: { value: 'Four' } });
    fireEvent.change(within(passage()).getByLabelText('Prompt'), { target: { value: 'p' } });
    const before = saved.length;
    fireEvent.click(within(passage()).getByRole('button', { name: 'Save' }));
    expect(screen.getAllByText(/At most 6 chips can show for phrases/).length).toBeGreaterThan(0);
    expect(saved).toHaveLength(before);
  });
});

describe('ordering', () => {
  it('moves a row down and keeps focus on its button', async () => {
    const saved = mount();
    const down = within(passage()).getByRole('button', { name: 'Move Explain down' });
    down.focus();
    fireEvent.click(down);
    expect(
      saved
        .at(-1)
        ?.passage.slice(0, 2)
        .map((entry) => entry.id),
    ).toEqual(['simplify', 'explain']);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(passage()).getByRole('button', { name: 'Move Explain down' }),
      ),
    );
  });

  it('moves focus to the twin button when the row reaches the end', async () => {
    mount();
    const up = within(article()).getByRole('button', { name: 'Move Key claims up' });
    up.focus();
    fireEvent.click(up);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(article()).getByRole('button', { name: 'Move Key claims down' }),
      ),
    );
  });

  it('disables Up on the first row and Down on the last', () => {
    mount();
    expect(
      (within(article()).getByRole('button', { name: 'Move Summarize up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(article()).getByRole('button', { name: 'Move Related down' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe('reset', () => {
  it('asks first, then restores the defaults and drops custom actions', () => {
    const saved = mount();
    addAction(article(), 'Plain words', 'One.');
    fireEvent.click(within(article()).getByRole('button', { name: 'Hide Summarize' }));
    const before = saved.length;
    fireEvent.click(
      within(article()).getByRole('button', { name: 'Reset article list to defaults' }),
    );
    expect(saved).toHaveLength(before);
    fireEvent.click(within(article()).getByRole('button', { name: 'Reset' }));
    expect(saved.at(-1)?.article).toEqual(defaultActions().article);
    expect(saved.at(-1)?.passage).toEqual(defaultActions().passage);
  });
});

function deferredSave() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('keeps rapid changes in the same and different lists and sends them in order', async () => {
  const first = deferredSave();
  const saved: LibrarianActions[] = [];
  const save = vi.fn((next: LibrarianActions) => {
    saved.push(next);
    return saved.length === 1 ? first.promise : Promise.resolve();
  });
  render(<QuickActionsEditor actions={defaultActions()} save={save} />);
  act(() => {
    fireEvent.click(within(passage()).getByRole('button', { name: 'Hide Explain' }));
    fireEvent.click(within(passage()).getByRole('button', { name: 'Hide Simplify' }));
    fireEvent.click(within(article()).getByRole('button', { name: 'Hide Summarize' }));
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(within(passage()).getByRole('button', { name: 'Show Explain' })).toBeTruthy();
  expect(within(passage()).getByRole('button', { name: 'Show Simplify' })).toBeTruthy();
  await act(async () => first.resolve());
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  expect(saved.at(-1)?.passage.slice(0, 2)).toEqual([
    { id: 'explain', hidden: true },
    { id: 'simplify', hidden: true },
  ]);
  expect(saved.at(-1)?.article[0]).toEqual({ id: 'summary', hidden: true });
});

it('rolls a failed save back to the confirmed value before the next success', async () => {
  const second = deferredSave();
  const saved: LibrarianActions[] = [];
  const save = vi.fn((next: LibrarianActions) => {
    saved.push(next);
    return saved.length === 2 ? second.promise : Promise.resolve();
  });
  render(<QuickActionsEditor actions={defaultActions()} save={save} />);
  fireEvent.click(within(passage()).getByRole('button', { name: 'Hide Explain' }));
  await act(async () => {});
  fireEvent.click(within(passage()).getByRole('button', { name: 'Hide Simplify' }));
  fireEvent.click(within(passage()).getByRole('button', { name: 'Hide Counterpoint' }));
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => second.reject(new Error('Could not save actions.')));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  expect(screen.getByRole('alert').textContent).toBe('Could not save actions.');
  expect(within(passage()).getByRole('button', { name: 'Show Explain' })).toBeTruthy();
  expect(within(passage()).getByRole('button', { name: 'Hide Simplify' })).toBeTruthy();
  expect(within(passage()).getByRole('button', { name: 'Show Counterpoint' })).toBeTruthy();
  expect(saved.at(-1)?.passage.slice(0, 3)).toEqual([
    { id: 'explain', hidden: true },
    { id: 'simplify', hidden: false },
    { id: 'counterpoint', hidden: true },
  ]);
});
