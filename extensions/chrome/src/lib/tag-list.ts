/**
 * The popup's tag-selection state + DOM rendering — extracted from
 * `popup/popup.ts` so it's independently testable (ce-correctness review
 * caught a real bug here: `addTag` used to call the render function with no
 * args, defaulting the suggestion list to `[]` and wiping every
 * not-yet-selected suggestion pill whenever the user typed a manual tag
 * after suggestions had already loaded).
 *
 * `TagListState` holds the two pieces of state a `TagListController` needs
 * across renders: which tags are selected, and the last-loaded suggestion
 * list (so a re-render triggered by `addTag` — which knows nothing about
 * suggestions — doesn't have to guess/lose them).
 */

export type TagListState = {
  selected: Set<string>;
  suggestions: string[];
};

export function createTagListState(): TagListState {
  return { selected: new Set(), suggestions: [] };
}

/** Adds a manually-typed tag to `selected`, preserving whatever `suggestions` were last rendered. */
export function addTag(state: TagListState, tag: string): void {
  state.selected.add(tag);
}

/** Toggles a tag's selection (clicking a pill). */
export function toggleTag(state: TagListState, tag: string): void {
  if (state.selected.has(tag)) state.selected.delete(tag);
  else state.selected.add(tag);
}

/** Replaces the suggestion list (e.g. after `GET /api/tags` resolves), keeping `selected` untouched. */
export function setSuggestions(state: TagListState, suggestions: string[]): void {
  state.suggestions = suggestions;
}

/** The full set of tags to render as pills: every selected tag plus every suggestion, deduplicated. Selected tags always render active regardless of whether they're also a suggestion. */
export function visibleTags(state: TagListState): string[] {
  return [...new Set([...state.selected, ...state.suggestions])];
}

/** Renders the tag pills into `container`, wiring each pill's click to `toggleTag` + `onChange` (the caller re-renders after every toggle so the active/inactive styling updates immediately). */
export function renderTagList(
  container: HTMLElement,
  state: TagListState,
  onChange: () => void,
): void {
  container.innerHTML = '';
  for (const tag of visibleTags(state)) {
    const pill = document.createElement('div');
    pill.className = `tag-pill${state.selected.has(tag) ? ' active' : ''}`;
    pill.textContent = tag;
    pill.addEventListener('click', () => {
      toggleTag(state, tag);
      onChange();
    });
    container.appendChild(pill);
  }
}
