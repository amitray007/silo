import { addTag, CaptureError, editNote, removeTag } from '../lib/capture-client.js';
import type { EditDiff } from '../lib/types.js';

/**
 * Applies an edit-card diff to an already-saved link, sequentially: note
 * PATCH (replace), then each added tag, then each removed tag. First failure
 * aborts. The Flow-1 save is untouched regardless.
 *
 * A mid-sequence failure means EARLIER calls already committed server-side
 * (each tag/note write persists immediately). Reporting a bare "failed" would
 * be dishonest — the user would believe nothing saved when part did. So the
 * result distinguishes a clean failure (nothing applied yet) from a partial
 * one (some changes are live), and the caller surfaces the truth. Retrying is
 * safe: addTag is `onConflictDoNothing` and note PATCH + removeTag are
 * idempotent, so re-running the whole diff converges.
 */
export async function applyEdit(
  id: string,
  diff: EditDiff,
): Promise<{ ok: true } | { ok: false; message: string; partial: boolean }> {
  let applied = 0;
  try {
    if (diff.note !== undefined) {
      await editNote(id, diff.note);
      applied++;
    }
    for (const tag of diff.addedTags) {
      await addTag(id, tag);
      applied++;
    }
    for (const tag of diff.removedTags) {
      await removeTag(id, tag);
      applied++;
    }
    return { ok: true };
  } catch (error) {
    const base = error instanceof CaptureError ? error.message : 'Could not save details';
    const partial = applied > 0;
    const message = partial ? `${base} Some changes were saved — try again to finish.` : base;
    return { ok: false, message, partial };
  }
}
