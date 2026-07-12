import { useCaptureLink } from '../api/hooks';
import { HeaderActionButton, type HeaderActionResult } from '../components/HeaderActionButton';
import { AddIcon } from '../components/NavIcons';
import { looksLikeUrl } from '../lib/url';
import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState } from './shared/ListStates';
import { useListView } from './shared/useListView';

/** `/`'s empty state copy — "nothing kept yet at all" (distinct from `TagView`'s per-tag empty copy). */
function LibraryEmptyState() {
  return (
    <EmptyState
      title="Nothing kept yet."
      body={
        <>
          Paste a link anywhere on this page — it's saved the moment it lands.
          <span
            style={{
              display: 'block',
              marginTop: 14,
              fontSize: '0.9em',
              color: 'var(--fnt)',
            }}
          >
            Claude can add links here too, once you connect it in Settings → API / MCP.
          </span>
        </>
      }
    />
  );
}

/**
 * The Library header's "paste to capture" button — a tap-to-do-Cmd+V
 * affordance living right of the "Library" heading, ALWAYS visible (desktop
 * AND mobile; the paste-anywhere document listener, `usePasteCapture`, has
 * no equivalent on a touch device with no synchronous paste-event target, so
 * this button is the mobile capture path). Reads the clipboard via
 * `navigator.clipboard.readText()` — the only clipboard API a button click
 * (rather than a real paste event) can use — feature-detected and
 * try/catch-wrapped, since it's unavailable in Firefox and rejects on a
 * denied/blocked permission or an insecure context. Reuses the SAME
 * capture path as every other entry point: `looksLikeUrl` to validate, then
 * `useCaptureLink().mutate` (the omnibar/paste-anywhere mutation) so this
 * gets the identical optimistic-insert/rollback/invalidate behavior for
 * free.
 *
 * Renders its chrome (the pill button + flash toast) via the shared
 * `HeaderActionButton` (method file, "tag-capture-empty-trash", decision 1) —
 * this component now only owns the clipboard-read/validate/capture BEHAVIOR.
 *
 * `tags?` (decision 2): when set, the capture applies these tags — `TagView`
 * passes `[tag]` so a tag page's Add button (and its clipboard-paste path)
 * tags the new link with the current tag; `LibraryView` passes nothing, an
 * untagged capture exactly as before. Every other behavior (clipboard read,
 * `looksLikeUrl`, flash messages, `isPending`) is unchanged.
 *
 * Never logs or surfaces the read clipboard text anywhere (including in the
 * toast) — only a fixed, pre-written message per outcome.
 */
export function PasteCaptureButton({ tags }: { tags?: string[] }) {
  const captureLink = useCaptureLink();

  async function handleClick(): Promise<HeaderActionResult> {
    const canRead = typeof navigator.clipboard?.readText === 'function';
    if (!canRead) {
      return { message: 'Clipboard access blocked', ok: false };
    }

    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Permission denied, insecure context, or any other read failure —
      // never throw, never leak WHY into the toast (no clipboard content,
      // no raw error message).
      return { message: 'Clipboard access blocked', ok: false };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return { message: 'Clipboard is empty', ok: false };
    }
    if (!looksLikeUrl(trimmed)) {
      return { message: "That doesn't look like a link", ok: false };
    }

    captureLink.mutate(tags ? { url: trimmed, tags } : { url: trimmed });
    return { message: 'Saved', ok: true };
  }

  return (
    <HeaderActionButton
      icon={<AddIcon />}
      label="Add"
      onClick={handleClick}
      disabled={captureLink.isPending}
      title="Paste a link from the clipboard"
      ariaLabel="Add a link from the clipboard"
    />
  );
}

/**
 * `/` — the Library list (plan 010; the omnibar's live search that plan 011
 * V3-2 added here has since moved OUT to the command palette, plan 024 —
 * this view is just the day-grouped browse feed now). Read-only rows via
 * `useListView()` (no tag scope), with pagination (the "load more" button +
 * prefetch sentinel). Shares its orchestration/header/body/state chrome with
 * `TagView` via `./shared/*` — see those modules' doc comments.
 *
 * The header carries only the title + the paste-capture button now — the
 * "Paste a link to keep" hint box was removed (direct user feedback: match
 * shiori's compact header, which has no top input). Capture still works
 * everywhere: pasting a URL anywhere on the page captures it via the
 * document-level `usePasteCapture` listener (mounted once in `AppFrame`),
 * and the header button below covers the tap-to-paste case a touch device
 * has no equivalent gesture for.
 */
export function LibraryView() {
  const view = useListView();

  return (
    <ContentFrame title="Library" headerSlot={<PasteCaptureButton />}>
      {ListBody(view, <LibraryEmptyState />)}
    </ContentFrame>
  );
}
