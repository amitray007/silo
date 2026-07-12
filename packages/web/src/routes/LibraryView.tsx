import { useCaptureLink } from '../api/hooks';
import { PasteIcon } from '../components/NavIcons';
import { looksLikeUrl } from '../lib/url';
import { usePasteFlash } from '../lib/usePasteFlash';
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
 * Never logs or surfaces the read clipboard text anywhere (including in the
 * toast) — only a fixed, pre-written message per outcome.
 */
function PasteCaptureButton() {
  const captureLink = useCaptureLink();
  const { message, ok, flash } = usePasteFlash();

  async function handleClick() {
    const canRead = typeof navigator.clipboard?.readText === 'function';
    if (!canRead) {
      flash('Clipboard access blocked', false);
      return;
    }

    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Permission denied, insecure context, or any other read failure —
      // never throw, never leak WHY into the toast (no clipboard content,
      // no raw error message).
      flash('Clipboard access blocked', false);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      flash('Clipboard is empty', false);
      return;
    }
    if (!looksLikeUrl(trimmed)) {
      flash("That doesn't look like a link", false);
      return;
    }

    captureLink.mutate({ url: trimmed });
    flash('Saved', true);
  }

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={captureLink.isPending}
        title="Paste a link from the clipboard"
        aria-label="Add a link from the clipboard"
        className="silo-icon-btn-sm"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--s1-5)',
          border: '1px solid var(--line)',
          background: 'var(--bg2)',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 'var(--text-base)',
          fontFamily: 'inherit',
          color: 'var(--ink)',
          cursor: 'pointer',
          opacity: captureLink.isPending ? 0.6 : 1,
        }}
      >
        <PasteIcon />
        Add
      </button>
      {message && (
        <span
          role={ok ? 'status' : 'alert'}
          aria-live={ok ? 'polite' : 'assertive'}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 'var(--s1-5)',
            padding: '6px 10px',
            background: 'var(--bg2)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            boxShadow: 'var(--elev-2)',
            fontSize: 'var(--text-sm)',
            color: ok ? 'var(--ink)' : 'var(--warn)',
            whiteSpace: 'nowrap',
            zIndex: 1,
          }}
        >
          {message}
        </span>
      )}
    </div>
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
