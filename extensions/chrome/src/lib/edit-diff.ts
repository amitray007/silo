import type { EditDiff, EditState } from './types.js';

const key = (t: string): string => t.trim().toLowerCase();

/**
 * Diffs the edit card's current state against what was saved. Returns null
 * when nothing changed (the card can skip all network calls). Note compares
 * trimmed; tags compare case-insensitively and order-insensitively, mirroring
 * the API's own tag dedup key (trim + lowercase).
 */
export function computeEditDiff(original: EditState, edited: EditState): EditDiff | null {
  const noteChanged = original.note.trim() !== edited.note.trim();
  const origKeys = new Set(original.tags.map(key));
  const editKeys = new Set(edited.tags.map(key));
  const addedTags = edited.tags.filter((t) => !origKeys.has(key(t)));
  const removedTags = original.tags.filter((t) => !editKeys.has(key(t)));

  if (!noteChanged && addedTags.length === 0 && removedTags.length === 0) return null;

  const diff: EditDiff = { addedTags, removedTags };
  if (noteChanged) diff.note = edited.note.trim();
  return diff;
}
