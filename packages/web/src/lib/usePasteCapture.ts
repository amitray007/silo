import { useEffect } from 'react';
import { useCaptureLink } from '../api/hooks';
import { looksLikeUrl } from './url';

/** Real, focusable text-entry elements a paste can legitimately target — pasting INTO one of these must never be hijacked into a silent capture. */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA']);

/**
 * Checks whether `target` (the paste event's target, or whatever currently
 * has focus) is a genuine text-entry control — an `<input>`/`<textarea>`, or
 * any element with `contenteditable` (a rich-text field, matching how a real
 * "am I typing into a field" check has to account for more than just the two
 * native tags). Exported for the module's own tests to exercise directly
 * without constructing a full paste event.
 *
 * Reads the `contenteditable` ATTRIBUTE (`closest('[contenteditable="true"],
 * [contenteditable=""], [contenteditable="plaintext-only"]')` — the three
 * attribute values that turn editing ON; `"false"`/absent do not) rather than
 * the `isContentEditable` DOM property — jsdom (this project's test
 * environment) doesn't implement that property (always `undefined`), and
 * checking the attribute also correctly covers an element that inherited
 * editability from a `contenteditable` ancestor, which a real paste target
 * often is (e.g. a `<span>` inside a rich-text editor's root). Includes
 * `"plaintext-only"` (review fix, CodeRabbit) alongside the more common
 * `"true"`/`""` — a plain-text-only editable region is still a real text
 * field a paste must not be hijacked from.
 */
export function isTextEntryElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TEXT_INPUT_TAGS.has(target.tagName)) return true;
  return (
    target.closest(
      '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
    ) !== null
  );
}

/**
 * Paste-to-capture (build brief, "Omnibar" item 3): pasting a URL anywhere
 * ON THE PAGE — not specifically into the omnibar — silently captures it via
 * `useCaptureLink`, the same mutation the omnibar's `keep ↵` uses (so it gets
 * the identical optimistic-insert/rollback/invalidate behavior, no separate
 * code path to keep in sync).
 *
 * `currentTag` (method file "tag-capture-empty-trash", decision 5): when the
 * active route is a tag page, `AppFrame` passes that tag here so a paste
 * ANYWHERE on the page (not just via the tag page's own `PasteCaptureButton`)
 * applies the SAME current-tag scoping a click on that button would. On
 * every other route (Library, Trash, Settings) `AppFrame` passes `undefined`
 * — an ordinary, untagged Library capture, unchanged from before.
 *
 * Guards, in order:
 * - Never hijacks a paste INTO a real text-entry element (`isTextEntryElement`
 *   — an `<input>`/`<textarea>`/`contenteditable`, checked against the
 *   event's own `target` first and `document.activeElement` as a fallback,
 *   since some browsers report a paste's `target` as the document for a
 *   handler registered there rather than the focused field itself). Pasting
 *   a URL into the omnibar, the edit modal's title/note fields, or the
 *   sidebar's tag-name input must behave like a normal paste — never trigger
 *   a SECOND, silent capture behind the user's back.
 * - Reads `event.clipboardData` (not `navigator.clipboard.readText()`, which
 *   is async and permission-gated) — the synchronous paste-event API needs
 *   no permission prompt and matches what "paste" actually means here.
 * - Only fires for text that `looksLikeUrl` accepts; anything else (a
 *   sentence, a code snippet, an image paste with no text representation) is
 *   silently ignored — no error, no chrome, exactly per the build brief
 *   ("silently ignore non-URLs, NO error shown").
 * - Calls `event.preventDefault()` once it decides to capture, so the browser
 *   doesn't ALSO insert the pasted text somewhere (there's no focused text
 *   field to insert into in the "onto the page" case this hook targets, but
 *   this keeps the intent explicit rather than relying on that always being
 *   true).
 *
 * Mounted once (in `AppFrame`, alongside the other app-wide singletons like
 * `RowMenuProvider`) rather than per-row/per-view — a document-level paste
 * can happen with nothing in particular focused, so there is no single
 * "owning" component for it to live inside.
 */
export function usePasteCapture(currentTag?: string): void {
  const captureLink = useCaptureLink();

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTextEntryElement(event.target) || isTextEntryElement(document.activeElement)) return;

      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (!text || !looksLikeUrl(text)) return;

      event.preventDefault();
      captureLink.mutate(currentTag ? { url: text, tags: [currentTag] } : { url: text });
    };

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // `captureLink.mutate` is TanStack Query's stable mutate function (same
    // reference for the mutation's lifetime), so listing it here doesn't
    // tear down/rebuild the listener on every render — it just satisfies the
    // hook the honest way rather than suppressing the lint. `currentTag` IS
    // listed (unlike `mutate`, it's a real value that changes on navigation)
    // so switching tag pages rebinds the listener to the new tag rather than
    // closing over a stale one.
  }, [captureLink.mutate, currentTag]);
}
