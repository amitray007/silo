import { useEffect, useMemo } from 'react';
import { useInfiniteLinks, useLinksByTag, useSearchLinks, useTags } from '../api/hooks';
import type { LinkJson, SearchResultJson, TagCount } from '../api/types';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import type { useCommandPalette } from '../lib/useCommandPalette';
import { Chip } from './Chip';
import { ModalShell } from './ModalShell';

/** A link result row's stable DOM id, for `aria-activedescendant`. */
function optionId(prefix: string, id: string): string {
  return `silo-palette-option-${prefix}-${id}`;
}

/**
 * The shared row shell style for both `PaletteLinkRow`/`PaletteTagRow`. The
 * resting background is deliberately OMITTED (CSS-owned via `.silo-palette-
 * row:hover` in base.css) — an inline `background: 'transparent'` would
 * always beat that CSS rule regardless of specificity (same trap `NavItem.
 * tsx`'s doc comment documents) and silently kill hover feedback on inactive
 * rows. Only the ACTIVE row gets an inline background, since "currently
 * keyboard-highlighted" is a per-instance boolean CSS can't express.
 */
function paletteRowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--s2-5)',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    padding: 'var(--s2) var(--s3)',
    border: 0,
    borderRadius: 8,
    cursor: 'pointer',
    font: 'inherit',
    ...(active ? { background: 'var(--hov)' } : {}),
  };
}

/** A single link result row (favicon + title + domain), scaled down from `LinkRow`'s look for the palette's tighter list. Enter/click both open the link in a new tab; the caller handles Enter, this handles click. */
function PaletteLinkRow({
  link,
  active,
  onSelect,
}: {
  link: LinkJson | SearchResultJson;
  active: boolean;
  onSelect: () => void;
}) {
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  return (
    <button
      type="button"
      id={optionId('link', link.id)}
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className="silo-palette-row"
      style={paletteRowStyle(active)}
    >
      <Chip domain={domain} size={18} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--s2-5)',
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: 'var(--text-base)',
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        <span
          style={{
            flex: 'none',
            maxWidth: '14rem',
            fontSize: 'var(--text-base)',
            color: 'var(--fnt)',
            fontWeight: 400,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {domain}
        </span>
      </span>
    </button>
  );
}

/** A single tag-suggestion row (`#tagname (count)`), shown while `partialTag` autocomplete is active. */
function PaletteTagRow({
  tag,
  active,
  onSelect,
}: {
  tag: TagCount;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={optionId('tag', tag.name)}
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className="silo-palette-row"
      style={{
        ...paletteRowStyle(active),
        gap: 'var(--s2)',
        fontSize: 'var(--text-base)',
        color: 'var(--ink)',
      }}
    >
      <span style={{ color: 'var(--ghost)' }}>#</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {tag.name}
      </span>
      <span style={{ flex: 'none', fontSize: 'var(--text-xs)', color: 'var(--fnt)' }}>
        {tag.count}
      </span>
    </button>
  );
}

/** The quiet empty-state hint shown when the palette has nothing to show yet — no request in flight, nothing typed. */
function PaletteHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 'var(--s5) var(--s4)',
        textAlign: 'center',
        fontSize: 'var(--text-base)',
        color: 'var(--fnt)',
      }}
    >
      {children}
    </div>
  );
}

export type CommandPaletteResult =
  | { kind: 'link'; link: LinkJson | SearchResultJson }
  | { kind: 'tag'; tag: TagCount };

/**
 * The palette's data-selection logic, pulled out of `CommandPalette` itself
 * (review: kept the component's own cognitive complexity under the repo's
 * lint ceiling) — decides WHICH of the four data hooks' results become the
 * visible `results` list, per `parseSearchQuery`'s branches:
 *
 * - `partialTag` set -> TAG suggestions (prefix-matched client-side against
 *   `useTags()`) — never link results, even if a settled `tag` is ALSO
 *   technically present (partialTag takes priority: the user is still
 *   actively typing the tag).
 * - Else a settled `tag` (with or without `text`) -> the tag-scoped view:
 *   `text` present fires `useSearchLinks(text, tag)` (AND); `text` absent
 *   fires `useLinksByTag(tag)` (all of that tag's links).
 * - Else `text` only -> `useSearchLinks(text)`.
 * - Else (fully empty query) -> the most recent N links (`useInfiniteLinks()`,
 *   first page only — no "load more" chrome here), so the palette isn't
 *   just a blank box the instant it opens. Chosen over a bare empty-state
 *   hint per the plan's own "showing recent/all is friendly" steer.
 *
 * All data hooks key off `debouncedQ`/`parsedDebounced` (200ms), never the
 * raw per-keystroke `q` — the visible input itself is never debounced.
 */
function usePaletteResults(
  parsed: ReturnType<typeof useCommandPalette>['parsed'],
  parsedDebounced: ReturnType<typeof useCommandPalette>['parsedDebounced'],
): { results: CommandPaletteResult[]; showTagSuggestions: boolean } {
  const { data: tagsData } = useTags();
  const allTags = tagsData?.tags ?? [];

  // MODE selection (tag-suggestions vs. link-search/list) and the actual
  // QUERY args below both derive from the SAME source — `parsedDebounced` —
  // never a mix of raw `parsed` for one and debounced for the other
  // (bugfix, plan 024 review: `showTagSuggestions` used to read raw
  // `parsed.partialTag` while `settledTag`/`searchText` read
  // `parsedDebounced`. For up to `SEARCH_DEBOUNCE_MS` after a keystroke that
  // settles a tag — e.g. typing a trailing space after `#frontend` — the two
  // could disagree: the UI would flip out of "tag suggestion" mode
  // instantly, but the debounced parse hadn't caught up yet, so the query
  // that actually fired was an UNSCOPED text search rather than the
  // tag-scoped one, and Enter in that window could act on the wrong
  // result). `parsed` (raw, undebounced) is used ONLY below for the
  // tag-prefix CLIENT-SIDE filter text — that's a cheap, already-loaded-data
  // filter, not a network request, so keeping it instant-reactive is a pure
  // UX win with no query-consistency risk.
  const showTagSuggestions = parsedDebounced.partialTag !== undefined;
  const tagPrefix = (parsed.partialTag ?? parsedDebounced.partialTag ?? '').toLowerCase();
  const matchingTags = useMemo(
    () =>
      showTagSuggestions ? allTags.filter((t) => t.name.toLowerCase().startsWith(tagPrefix)) : [],
    [showTagSuggestions, allTags, tagPrefix],
  );

  const settledTag = showTagSuggestions ? undefined : parsedDebounced.tag;
  const searchText = showTagSuggestions ? '' : parsedDebounced.text;
  const hasText = searchText.trim().length > 0;
  const hasSettledTag = settledTag !== undefined && settledTag.length > 0;

  const searchQuery = useSearchLinks(
    hasText ? searchText : '',
    hasSettledTag ? settledTag : undefined,
  );
  const tagOnlyQuery = useLinksByTag(hasSettledTag && !hasText ? settledTag : undefined);
  const recentQuery = useInfiniteLinks();

  const isFullyEmpty = !showTagSuggestions && !hasText && !hasSettledTag;

  const linkResults: Array<LinkJson | SearchResultJson> = showTagSuggestions
    ? []
    : selectLinkResults({
        hasText,
        hasSettledTag,
        isFullyEmpty,
        searchResults: searchQuery.data?.results,
        tagResults: tagOnlyQuery.data?.links,
        recentResults: recentQuery.data?.pages[0]?.links,
      });

  const results: CommandPaletteResult[] = showTagSuggestions
    ? matchingTags.map((tag) => ({ kind: 'tag', tag }) as const)
    : linkResults.map((link) => ({ kind: 'link', link }) as const);

  return { results, showTagSuggestions };
}

/** The link-results source-picking branch, split out of `usePaletteResults` purely to keep both functions under the lint's cognitive-complexity ceiling. */
function selectLinkResults(args: {
  hasText: boolean;
  hasSettledTag: boolean;
  isFullyEmpty: boolean;
  searchResults: SearchResultJson[] | undefined;
  tagResults: LinkJson[] | undefined;
  recentResults: LinkJson[] | undefined;
}): Array<LinkJson | SearchResultJson> {
  if (args.hasText) return args.searchResults ?? [];
  if (args.hasSettledTag) return args.tagResults ?? [];
  if (args.isFullyEmpty) return args.recentResults ?? [];
  return [];
}

/**
 * The floating, keyboard-first command center (plan 024) — mounted ONCE at
 * the app root (`AppFrame.tsx`), driven entirely by `useCommandPalette()`'s
 * state. Reuses `ModalShell` for the scrim/panel/focus-trap/Escape/
 * focus-restore chrome (see that component's doc comment) rather than
 * reimplementing it — this component only owns the combobox input +
 * listbox results INSIDE the shell; the data-selection branching lives in
 * `usePaletteResults` above.
 */
export function CommandPalette({ palette }: { palette: ReturnType<typeof useCommandPalette> }) {
  const {
    open,
    closePalette,
    q,
    setQ,
    parsed,
    parsedDebounced,
    activeIndex,
    setActiveIndex,
    moveActive,
  } = palette;
  const { results, showTagSuggestions } = usePaletteResults(parsed, parsedDebounced);
  const isFullyEmpty = !showTagSuggestions && !parsedDebounced.text.trim() && !parsedDebounced.tag;

  // Clamp `activeIndex` against the CURRENT `results` length (bugfix, plan
  // 024 review): `activeIndex` only gets explicitly reset to 0 on a
  // keystroke (the input's `onChange`) or on close — it is NOT reset when
  // `results` itself shrinks WITHOUT a keystroke, which happens routinely
  // here: `useInfiniteLinks()` (the empty-query "recent links" view) polls
  // every 1.5s while anything is still enriching, and any debounced query
  // settling can resolve to fewer rows than the previous render. Left
  // unclamped, a stale `activeIndex` past the new `results.length` makes
  // `results[activeIndex]` `undefined` — Enter then silently no-ops (dead
  // keyboard shortcut) and `aria-activedescendant` points at a DOM id that
  // no longer exists. Clamping at RENDER time (not only via an effect) means
  // there's no one-frame flash of a broken highlighted/actionable row.
  const clampedActiveIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  // Persist the clamp into state too (not just the render-time view above),
  // so a SUBSEQUENT relative move (`moveActive(1, results.length)` on the
  // next ArrowDown) starts from the corrected index rather than silently
  // reading a stale out-of-range `activeIndex` on its next call.
  useEffect(() => {
    if (activeIndex !== clampedActiveIndex) {
      setActiveIndex(clampedActiveIndex);
    }
  }, [activeIndex, clampedActiveIndex, setActiveIndex]);

  if (!open) return null;

  const activeOption = results[clampedActiveIndex];
  const activeOptionId = activeOption
    ? activeOption.kind === 'link'
      ? optionId('link', activeOption.link.id)
      : optionId('tag', activeOption.tag.name)
    : undefined;

  const openLinkResult = (link: LinkJson | SearchResultJson) => {
    // Mirrors `LinkRow`'s own anchor semantics (`target="_blank" rel="noopener"`).
    // Scheme guard (defense-in-depth, review fix): `link.url` is stored,
    // agent-writable data (the `capture_link` MCP tool can set an arbitrary
    // `url`), not something this component itself validated. Modern browsers
    // already refuse to navigate `window.open` to a `javascript:`/`data:`
    // scheme from a cross-origin-ish call, but that's a browser mitigation,
    // not a guarantee this codebase should lean on — only ever actually
    // OPEN an http(s) url; anything else is silently ignored (still closes
    // the palette, matching the "Enter acted" feel, but navigates nowhere).
    if (/^https?:\/\//i.test(link.url)) {
      window.open(link.url, '_blank', 'noopener');
    }
    closePalette();
  };

  const applyTagSuggestion = (tag: TagCount) => {
    // Replaces the trailing partial `#word` with the full `#tagname`,
    // keeping any leading text — does NOT close the palette (per the plan:
    // Enter on a tag suggestion applies/completes the filter, the user may
    // keep typing or hit Enter again once link results show).
    const upToPartial = q.slice(0, q.length - (parsed.partialTag?.length ?? 0));
    setQ(`${upToPartial}${tag.name} `);
  };

  const selectActive = () => {
    if (!activeOption) return;
    if (activeOption.kind === 'link') {
      openLinkResult(activeOption.link);
    } else {
      applyTagSuggestion(activeOption.tag);
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1, results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1, results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectActive();
    }
    // Escape is handled by ModalShell's own capture-phase document listener
    // (closePalette is passed through as `onClose` below) — no local handler
    // needed here.
  };

  return (
    <ModalShell width={560} ariaLabel="Command palette" onClose={closePalette}>
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s2-5)',
            paddingBottom: 'var(--s3)',
            marginBottom: 'var(--s3)',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <input
            ref={palette.inputRef}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="silo-palette-listbox"
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-label="Search links and tags"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              palette.setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search links…"
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              background: 'none',
              outline: 'none',
              font: 'inherit',
              fontSize: '0.95rem',
              color: 'var(--ink)',
              padding: 0,
            }}
          />
        </div>

        <div
          id="silo-palette-listbox"
          role="listbox"
          aria-label={showTagSuggestions ? 'Matching tags' : 'Matching links'}
          style={{
            maxHeight: '55vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {results.length === 0 &&
            (isFullyEmpty ? (
              <PaletteHint>Type to search links and #tags</PaletteHint>
            ) : showTagSuggestions ? (
              <PaletteHint>No matching tags</PaletteHint>
            ) : (
              <PaletteHint>No results</PaletteHint>
            ))}

          {results.map((result, index) =>
            result.kind === 'link' ? (
              <PaletteLinkRow
                key={result.link.id}
                link={result.link}
                active={index === clampedActiveIndex}
                onSelect={() => openLinkResult(result.link)}
              />
            ) : (
              <PaletteTagRow
                key={result.tag.name}
                tag={result.tag}
                active={index === clampedActiveIndex}
                onSelect={() => applyTagSuggestion(result.tag)}
              />
            ),
          )}
        </div>
      </div>
    </ModalShell>
  );
}
