/**
 * The edit card's tag-dropdown model — pure state + queries, DOM-free so it's
 * testable without jsdom. The injected UI (lib/toast.ts) renders from these.
 * Replaces the old inline-pill model; filtering + create-new + toggle live
 * here.
 */
export type TagOption = { name: string; count: number };
export type TagPickerState = { all: TagOption[]; selected: Set<string>; query: string };

const key = (t: string): string => t.trim().toLowerCase();

export function createTagPicker(all: TagOption[], selected: string[] = []): TagPickerState {
  return { all, selected: new Set(selected), query: '' };
}

/** Existing tags matching the current query (case-insensitive substring). */
export function filterTags(state: TagPickerState): TagOption[] {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.all;
  return state.all.filter((t) => t.name.toLowerCase().includes(q));
}

export function toggleTag(state: TagPickerState, name: string): void {
  if (state.selected.has(name)) state.selected.delete(name);
  else state.selected.add(name);
}

/** The query as a new-tag candidate, or null if empty / already an existing tag. */
export function canCreate(state: TagPickerState): string | null {
  const trimmed = state.query.trim();
  if (!trimmed) return null;
  const exists = state.all.some((t) => key(t.name) === key(trimmed));
  return exists ? null : trimmed;
}

export function selectedList(state: TagPickerState): string[] {
  return [...state.selected];
}
