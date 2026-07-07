import { describe, expect, it } from 'vitest';
import {
  addTag,
  createTagListState,
  renderTagList,
  setSuggestions,
  toggleTag,
  visibleTags,
} from './tag-list.js';

describe('tag-list', () => {
  it('addTag selects a tag without touching suggestions', () => {
    const state = createTagListState();
    setSuggestions(state, ['ai', 'reading']);
    addTag(state, 'my-manual-tag');
    expect(state.selected.has('my-manual-tag')).toBe(true);
    expect(state.suggestions).toEqual(['ai', 'reading']);
  });

  it('regression: a manually-typed tag no longer wipes already-loaded suggestions from visibleTags (the bug ce-correctness review caught)', () => {
    const state = createTagListState();
    setSuggestions(state, ['ai', 'reading']);
    addTag(state, 'my-manual-tag');
    // Before the fix, `addTag` re-rendered with an empty suggestion list —
    // this asserts every suggestion is still visible alongside the new tag.
    expect(visibleTags(state)).toEqual(expect.arrayContaining(['ai', 'reading', 'my-manual-tag']));
  });

  it('toggleTag adds an unselected tag and removes a selected one', () => {
    const state = createTagListState();
    toggleTag(state, 'ai');
    expect(state.selected.has('ai')).toBe(true);
    toggleTag(state, 'ai');
    expect(state.selected.has('ai')).toBe(false);
  });

  it('visibleTags deduplicates a tag that is both selected and a suggestion', () => {
    const state = createTagListState();
    setSuggestions(state, ['ai']);
    addTag(state, 'ai');
    expect(visibleTags(state)).toEqual(['ai']);
  });

  it('setSuggestions replaces the suggestion list without touching selected tags', () => {
    const state = createTagListState();
    addTag(state, 'kept');
    setSuggestions(state, ['new-suggestion']);
    expect(state.selected.has('kept')).toBe(true);
    expect(state.suggestions).toEqual(['new-suggestion']);
  });

  it('renderTagList renders a pill per visible tag, active class only on selected ones', () => {
    const state = createTagListState();
    setSuggestions(state, ['ai', 'reading']);
    addTag(state, 'ai');

    const container = document.createElement('div');
    renderTagList(container, state, () => {});

    const pills = [...container.querySelectorAll('.tag-pill')];
    expect(pills).toHaveLength(2);
    const aiPill = pills.find((p) => p.textContent === 'ai');
    const readingPill = pills.find((p) => p.textContent === 'reading');
    expect(aiPill?.className).toContain('active');
    expect(readingPill?.className).not.toContain('active');
  });

  it('renderTagList wires each pill to toggle selection and call onChange', () => {
    const state = createTagListState();
    setSuggestions(state, ['ai']);
    let changeCount = 0;

    const container = document.createElement('div');
    renderTagList(container, state, () => {
      changeCount += 1;
    });

    const pill = container.querySelector('.tag-pill') as HTMLElement;
    pill.click();

    expect(state.selected.has('ai')).toBe(true);
    expect(changeCount).toBe(1);
  });
});
