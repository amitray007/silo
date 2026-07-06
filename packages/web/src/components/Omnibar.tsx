import { forwardRef } from 'react';

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
  /** How many results/rows are currently shown — feeds both the `{found} esc` (search) and `{shown} of {libCount} esc` (tag-idle) chips. */
  shownCount: number;
  /** The Library's total live-link count (`{shown} of {libCount}`). */
  libCount: number;
};

/**
 * The v3 content-header omnibar (`Silo-v3.html` lines 76-94, plan 011 V3-2).
 * A controlled input matching v3's exact box model
 * (`width:clamp(230px,42%,430px)`, `gap:9px`, `border-radius:10px`,
 * `padding:8px 13px`, `--bg2` fill) with the magnifier SVG on the left and
 * one of four mutually-exclusive right-side states, mirroring v3's state
 * derivation exactly (`Silo-v3.html`'s render function):
 *
 * - `omniIsUrl = isUrl(q)` — typed text looks like a URL → the `keep ↵`
 *   affordance. THIS SLICE renders it but wires no capture (V3-3 owns
 *   `POST /links`); `onKeep` is a stub the caller may no-op.
 * - `omniIsSearch = words.length > 0` (i.e. `q` non-empty AND not a URL —
 *   v3's `words` array is empty whenever `isUrl(q)`, so these two states are
 *   naturally mutually exclusive) → `{shownCount} found · esc`.
 * - `omniTagIdle = !q.trim() && tag active` → `{shownCount} of {libCount} esc`.
 * - `omniIdle = !q.trim() && no tag active` → the `⌘ K` hint chip.
 *
 * The tag-filter pill (`#tag ✕`) renders INSIDE the bar, left of the input,
 * per v3's `tagActive = !!tag && !words.length` — visible only while a tag
 * filter is active AND there's no search text typed (typing a search hides
 * the pill even though the tag scoping is still logically in effect for
 * "what's being searched").
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
    shownCount,
    libCount,
  },
  ref,
) {
  const hasQuery = value.trim().length > 0;
  const omniIsUrl = hasQuery && looksLikeUrl;
  const omniIsSearch = hasQuery && !looksLikeUrl;
  const tagFilterActive = tagName !== undefined;
  const omniTagIdle = !hasQuery && tagFilterActive;
  const omniIdle = !hasQuery && !tagFilterActive;
  const tagPillVisible = tagFilterActive && !omniIsSearch;

  const placeholder = tagFilterActive
    ? `Search in #${tagName}`
    : 'Paste a link to keep · type to search';

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
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--ghost)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flex: 'none' }}
        aria-hidden="true"
      >
        <title>Search</title>
        <circle cx="7" cy="7" r="4.3" />
        <path d="m10.3 10.3 3 3" />
      </svg>

      {tagPillVisible && (
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
      {omniIsSearch && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s1-5)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '0.72rem', color: 'var(--fnt)' }}>{shownCount} found</span>
          <EscChip>esc</EscChip>
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
            {shownCount} of {libCount}
          </span>
          <EscChip>esc</EscChip>
        </span>
      )}
      {omniIdle && (
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
          ⌘ K
        </span>
      )}
    </div>
  );
});

/** The small bordered `esc`/`↵` pill shared by the URL and search right-side states. */
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
