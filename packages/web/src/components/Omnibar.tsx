import { forwardRef } from 'react';
import { SearchIcon } from './NavIcons';

export type OmnibarProps = {
  /** The raw (undebounced) input value — always what the user is actually typing. */
  value: string;
  onChange: (value: string) => void;
  /** Fires on Enter — only meaningful in `keep`/URL mode (V3-3 wires the actual capture); a no-op in every other mode. */
  onKeep: () => void;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  /** `true` once `value` looks like a URL — switches the right-side affordance to `keep ↵`. */
  looksLikeUrl: boolean;
  /** The active tag filter's name (`/tags/:name`), or `undefined` when none is active. */
  tagName?: string;
  onClearTag: () => void;
  /** How many live links carry the active tag — the tag-idle chip's `{tagCount} of {libCount}`. Unused (and unread) when no tag filter is active. */
  tagCount: number;
  /** The Library's total live-link count — the tag-idle chip's `{tagCount} of {libCount}`. */
  libCount: number;
};

/**
 * The v3 content-header omnibar (`Silo-v3.html` lines 76-94, plan 011 V3-2) —
 * PASTE-ONLY as of plan 024 (command center): its inline search role moved
 * entirely to the command palette (⌘K/`/`), so this component no longer has
 * a search mode at all. A controlled input matching v3's exact box model
 * (`width:clamp(230px,42%,430px)`, `gap:9px`, `border-radius:10px`,
 * `padding:8px 13px`, `--bg2` fill) with the magnifier SVG on the left and
 * TWO mutually-exclusive right-side states (down from v3's four —
 * `omniIsSearch` is gone, and the idle state now renders nothing rather than
 * a named chip):
 *
 * - `omniIsUrl = isUrl(q)` — typed text looks like a URL → the `keep ↵`
 *   affordance (V3-3 wires the real `POST /links` capture).
 * - `omniTagIdle = !q.trim() && tag active` → `{tagCount} of {libCount} esc`
 *   (the tag's own live-link count vs. the library total — UNRELATED to
 *   search, this is tag-scoped BROWSING via `/tags/:name`, which is
 *   untouched by the search-removal).
 * - Otherwise (idle, no query, no tag) → renders NOTHING in the right-side
 *   slot. The old `⌘ K` hint chip is REMOVED here (plan 024):
 *   ⌘K no longer focuses this input, it opens the command palette instead —
 *   showing "⌘ K" on the omnibar as if it still does something for THIS
 *   field would be misleading now that the shortcut's target moved
 *   elsewhere. The sidebar's Search nav item carries the palette's own `/`
 *   hint instead.
 *
 * The tag-filter pill (`#tag ✕`) renders INSIDE the bar, left of the input,
 * whenever a tag filter is active — tag-scoped browsing (not search) is
 * unaffected by the search-removal, so the pill's visibility is no longer
 * gated on "no search text typed" (there's no search text to type anymore).
 */
export const Omnibar = forwardRef<HTMLInputElement, OmnibarProps>(function Omnibar(
  {
    value,
    onChange,
    onKeep,
    focused,
    onFocus,
    onBlur,
    looksLikeUrl,
    tagName,
    onClearTag,
    tagCount,
    libCount,
  },
  ref,
) {
  const hasQuery = value.trim().length > 0;
  const omniIsUrl = hasQuery && looksLikeUrl;
  const tagFilterActive = tagName !== undefined;
  const omniTagIdle = !hasQuery && tagFilterActive;

  const placeholder = 'Paste a link to keep';

  return (
    <div
      style={{
        // Bigger per repeated user feedback ("increase the size of the input
        // box"): wider clamp bounds and a taller field so "Paste a link to
        // keep" reads as the app's primary action. Grown from
        // clamp(280,46%,520) and --s2-5 vertical padding.
        width: 'clamp(320px, 52%, 620px)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2-5)',
        border: `1px solid ${focused ? 'var(--ghost)' : 'var(--line)'}`,
        borderRadius: 11,
        background: 'var(--bg2)',
        padding: 'var(--s3) var(--s4)',
        transition: 'border-color .15s ease, background .2s ease',
      }}
    >
      <SearchIcon />

      {tagFilterActive && (
        <button
          type="button"
          onClick={onClearTag}
          title="Clear filter"
          aria-label={`Clear filter #${tagName}`}
          className="silo-tag-pill"
          style={{
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s1-5)',
            border: '1px solid var(--line)',
            background: 'var(--bg)',
            borderRadius: 999,
            padding: 'var(--s-0-5) var(--s2-5)',
            fontFamily: 'inherit',
            fontSize: '0.74rem',
            fontWeight: 500,
            color: 'var(--mut)',
            cursor: 'pointer',
          }}
        >
          <span style={{ color: 'var(--ghost)' }}>#</span>
          {tagName}
          <span style={{ color: 'var(--ghost)', fontSize: '0.68rem' }}>✕</span>
        </button>
      )}

      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && omniIsUrl) {
            onKeep();
          } else if (e.key === 'Escape') {
            onChange('');
            (e.target as HTMLInputElement).blur();
          }
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: 0,
          background: 'none',
          outline: 'none',
          font: 'inherit',
          fontSize: '0.92rem',
          color: 'var(--ink)',
          padding: 0,
        }}
      />

      {omniIsUrl && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s1-5)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '0.74rem', color: 'var(--markt)', fontWeight: 500 }}>Keep</span>
          <EscChip>↵</EscChip>
        </span>
      )}
      {omniTagIdle && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s1-5)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '0.72rem', color: 'var(--fnt)' }}>
            {tagCount} of {libCount}
          </span>
          <EscChip>esc</EscChip>
        </span>
      )}
      {/* The idle right-side slot (no query, no tag filter) renders nothing
          (plan 024): the old `⌘ K` hint chip is gone — ⌘K no longer focuses
          THIS input, it opens the command palette instead, so showing the
          hint here would be misleading now that the shortcut's target moved
          elsewhere. */}
    </div>
  );
});

/** The small bordered `esc`/`↵` pill shared by the URL and tag-idle right-side states. */
function EscChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: '0.66rem',
        color: 'var(--fnt)',
        border: '1px solid var(--line)',
        borderRadius: 5,
        padding: 'var(--s-0-5) var(--s1-5)',
        background: 'var(--bg)',
      }}
    >
      {children}
    </span>
  );
}
