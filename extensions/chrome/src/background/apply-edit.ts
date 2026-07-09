import { addTag, CaptureError, editNote, removeTag } from '../lib/capture-client.js';
import type { EditDiff } from '../lib/types.js';

/**
 * Applies an edit-card diff to an already-saved link, sequentially: note
 * PATCH (replace), then each added tag, then each removed tag. First failure
 * aborts and surfaces its message — the Flow-1 save is untouched regardless.
 */
export async function applyEdit(
  id: string,
  diff: EditDiff,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (diff.note !== undefined) await editNote(id, diff.note);
    for (const tag of diff.addedTags) await addTag(id, tag);
    for (const tag of diff.removedTags) await removeTag(id, tag);
    return { ok: true };
  } catch (error) {
    const message = error instanceof CaptureError ? error.message : 'Could not save details';
    return { ok: false, message };
  }
}
