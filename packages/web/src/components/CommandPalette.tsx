import { Command } from 'cmdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteLinks,
  useLinksByTag,
  useSearchLinks,
  useSearchTrash,
  useSettings,
  useTags,
  useTrashList,
} from '../api/hooks';
import type {
  LinkJson,
  SearchResultJson,
  SettingsMap,
  TagCount,
  TrashLinkJson,
  TrashSearchResultJson,
} from '../api/types';
import { isPaletteSurfaceOn } from '../lib/paletteSurface';
import { isHoverCapable } from '../lib/pointer';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import type { useCommandPalette } from '../lib/useCommandPalette';
import { type PaletteScope, usePaletteScope } from '../lib/usePaletteScope';
import { Chip } from './Chip';
import { useHoverPreview } from './HoverPreviewContext';

/** Either a live link result or a trashed one — `PaletteLinkRow` only ever reads `.id`/`.url`/`.title`, and `TrashLinkJson`/its search variant are both structurally `LinkJson` plus extra fields, so one row renderer covers both scopes. */
type PaletteLinkResult = LinkJson | SearchResultJson | TrashLinkJson;

/** The default number of "most recent" links shown when the palette opens with an empty query — deliberately a short list (not the full library), so the empty state reads as "here's what you were just doing" rather than becoming a second Library view. */
const RECENT_DEFAULT_COUNT = 5;

/**
 * Holds onto the last non-empty `results` array while a NEW one is still
 * settling (`isPending`/`isFetching` for the in-flight query behind it) —
 * the actual fix for the reported "flicker while typing": `usePaletteResults`
 * derives `results` fresh from whichever TanStack query is active for the
 * current mode, and each keystroke's debounced re-parse can briefly point at
 * a DIFFERENT query object (e.g. `useSearchLinks('reac')` vs
 * `useSearchLinks('react')` are distinct cache entries) that hasn't resolved
 * yet — naively rendering that query's `data` mid-flight blanks the list to
 * empty for a frame, then pops back in once the fetch lands, which reads as a
 * jump/flicker. This hook is the `placeholderData: keepPreviousData`
 * equivalent for a value that isn't itself a single `useQuery` call (it's
 * assembled from up to three different hooks depending on parse mode) —
 * TanStack's own `placeholderData` option can't be bolted onto that
 * cross-hook selection from here, so the same "hold the last real value
 * across a pending refetch" behavior is reproduced by hand: `isSettling`
 * (true while the CURRENT mode's underlying query has no data yet) selects
 * between the fresh `results` and whatever was last shown, and the ref only
 * ever updates when `isSettling` is false — never with a mid-flight blank.
 *
 * This continues to matter with cmdk in the mix: cmdk's `<Command>` only
 * renders/navigates whatever `<Command.Item>`s are mounted at any instant —
 * feeding it a momentarily-empty list (mid-refetch) would still cause the
 * same visible blank/jump cmdk itself doesn't prevent (cmdk's own filtering
 * story is for a static CLIENT list; silo's results are server-driven, hence
 * `shouldFilter={false}` below and this hook still doing the smoothing).
 */
function useStableResults(
  results: CommandPaletteResult[],
  isSettling: boolean,
): CommandPaletteResult[] {
  const lastRef = useRef<CommandPaletteResult[]>([]);
  if (!isSettling) {
    lastRef.current = results;
  }
  return isSettling ? lastRef.current : results;
}

/** The stable `value` cmdk uses to identify each result row (also becomes the DOM id cmdk assigns internally) — kept distinct per kind so a link id can never collide with a tag name. */
function resultValue(result: CommandPaletteResult): string {
  return result.kind === 'link' ? `link:${result.link.id}` : `tag:${result.tag.name}`;
}

/** The input placeholder, scoped to the current page — an honest hint about WHAT the palette is about to search (direct user decision: the palette replaces each page's own search box, so it should read like that page's search, not a generic global one). */
function scopePlaceholder(scope: PaletteScope): string {
  if (scope.kind === 'trash') return 'Search trash…';
  if (scope.kind === 'tag') return `Search #${scope.tag}…`;
  return 'Search links…';
}

/**
 * A footer keyboard hint: a small key-cap glyph (`↑↓`, `↵`, `esc`) + its label
 * on ONE shared vertical center. The glyph lives in an inline-flex box with
 * `lineHeight: 1` + `place-items:center`, so Unicode arrows — whose own font
 * metrics otherwise float above/below the Latin label — line up cleanly with
 * the word beside them (user feedback: the navigate/open/close glyphs looked
 * misaligned with their text). The pair is itself `align-items:center`.
 */
function PaletteHint({ glyph, label }: { glyph: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s1-5)' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          minWidth: 18,
          height: 16,
          padding: '0 var(--s1)',
          borderRadius: 4,
          border: '1px solid var(--line)',
          background: 'var(--bg2)',
          color: 'var(--mut)',
          fontSize: 'var(--text-xs)',
        }}
      >
        {glyph}
      </span>
      <span style={{ lineHeight: 1 }}>{label}</span>
    </span>
  );
}

/**
 * Whether this link's palette hover + inline surface should show. Plugin
 * sources (hacker_news/github/youtube/twitter) are gated by their own
 * `palette` flag via `isPaletteSurfaceOn`; any other kind (a plain `link`) is
 * ungated — its `GenericVariant` hover always shows, matching the library.
 */
function palettePluginOn(
  kind: PaletteLinkResult['sourceData']['kind'],
  plugins: SettingsMap['plugins'] | undefined,
): boolean {
  if (kind === 'hacker_news' || kind === 'github' || kind === 'youtube' || kind === 'twitter') {
    return isPaletteSurfaceOn(plugins?.[kind]);
  }
  return true; // generic link — always show hover
}

/** A single link result row (favicon + title + domain), scaled down from `LinkRow`'s look for the palette's tighter list. `Command.Item`'s own `onSelect` handles both click and Enter-while-active — no separate keydown handler needed. Renders trash-scope rows identically to library/tag ones (see `PaletteLinkResult`'s doc comment). Hover preview + inline source-line mirror the library row (`LinkRow`), gated per plugin by the palette `palette` flag; a generic link always gets its hover card. */
function PaletteLinkRow({ link }: { link: PaletteLinkResult }) {
  const domain = deriveDomain(link.url);
  const title = link.title ?? deriveTitleFromUrl(link.url);
  const rowRef = useRef<HTMLSpanElement>(null);
  const { data: settings } = useSettings();
  const { scheduleShow, scheduleHide, dismiss } = useHoverPreview();

  const kind = link.sourceData.kind;
  const surfaceOn = palettePluginOn(kind, settings?.plugins);
  const showInline = surfaceOn && (kind === 'hacker_news' || kind === 'twitter');

  // Mirror LinkRow's hover triggers: schedule the shared card on enter,
  // hide on leave, dismiss on unmount (the row unmounts as the list
  // re-renders while typing). Suppress when the source's palette surface is
  // off or the pointer can't hover (touch) — `scheduleShow`'s `suppress`
  // path cancels any pending timer without opening.
  const handleEnter = () => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    scheduleShow(link, rect, { suppress: !surfaceOn || !isHoverCapable() });
  };
  const handleLeave = () => scheduleHide(link.id);
  useEffect(() => () => dismiss(link.id), [dismiss, link.id]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-only convenience (schedules the shared preview card) on a non-interactive wrapper — the actual control is the parent `Command.Item`, which already has full keyboard/click semantics; this span adds no interactive behavior of its own.
    <span
      ref={rowRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-0-5)',
        width: '100%',
        minWidth: 0,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2-5)',
          width: '100%',
          minWidth: 0,
        }}
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
      </span>
      {showInline && link.sourceData.kind === 'hacker_news' && (
        <span
          style={{
            // Align under the title: 18px chip + --s2-5 gap.
            paddingLeft: 'calc(18px + var(--s2-5))',
            fontSize: 'var(--text-sm)',
            color: 'var(--fnt)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {link.sourceData.points} points · {link.sourceData.comments} comments
        </span>
      )}
      {showInline && link.sourceData.kind === 'twitter' && (
        <span
          style={{
            paddingLeft: 'calc(18px + var(--s2-5))',
            fontSize: 'var(--text-sm)',
            color: 'var(--fnt)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {link.sourceData.text}
        </span>
      )}
    </span>
  );
}

/** A single tag-suggestion row (`#tagname (count)`), shown while `partialTag` autocomplete is active. */
function PaletteTagRow({ tag }: { tag: TagCount }) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2)',
        width: '100%',
        minWidth: 0,
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
    </span>
  );
}

type CommandPaletteResult =
  | { kind: 'link'; link: PaletteLinkResult }
  | { kind: 'tag'; tag: TagCount };

/**
 * The palette's data-selection logic, pulled out of `CommandPalette` itself
 * (review: kept the component's own cognitive complexity under the repo's
 * lint ceiling) — decides WHICH data hook's results become the visible
 * `results` list, per `parseSearchQuery`'s branches AND the current page
 * `scope` (`usePaletteScope`, direct user decision: the palette now scopes
 * to whatever page it was opened from, replacing that page's own top search
 * box):
 *
 * - `partialTag` set -> TAG suggestions (prefix-matched client-side against
 *   `useTags()`) — never link results, even if a settled `tag` is ALSO
 *   technically present (partialTag takes priority: the user is still
 *   actively typing the tag). Tag suggestions/filtering are UNAVAILABLE in
 *   `trash` scope (the trash API has no tag concept — trashed links don't
 *   even retain their tags, see `trash.ts`'s `POST /links/:id/trash` doc
 *   comment) — `showTagSuggestions` is forced `false` there regardless of
 *   what the user typed, and any `#word` token is left as literal search
 *   text rather than silently stripped.
 * - Else a settled `tag` -> the tag-scoped view. In `library`/`tag` scope
 *   this is the user's OWN typed `#tag`, falling back to the CURRENT route's
 *   tag when the query has none (`scope.kind === 'tag'` and nothing typed) —
 *   an explicit `#othertag` always overrides the page's implicit scope, so
 *   `#tag` autocomplete/switching keeps working identically on a `/tags/:x`
 *   page as it did before this scoping existed. `text` present fires
 *   `useSearchLinks(text, tag)` (AND); `text` absent fires
 *   `useLinksByTag(tag)` (all of that tag's links).
 * - Else `text` only -> `useSearchLinks(text)` in `library`/`tag` scope (tag
 *   scope with no explicit `#tag` still carries the route's implicit tag
 *   into this branch via the fallback above), or `useSearchTrash(text)` in
 *   `trash` scope.
 * - Else (fully empty query) -> the `RECENT_DEFAULT_COUNT` (5) most recent
 *   items FOR THE CURRENT SCOPE: `useInfiniteLinks()` (library),
 *   `useInfiniteLinks(scope.tag)` (tag page), or `useTrashList()` (trash) —
 *   first page only, sliced down, no "load more" chrome. So the palette
 *   isn't just a blank box the instant it opens, but also doesn't become a
 *   second scrollable list view. Chosen over a bare empty-state hint per the
 *   plan's own "showing recent/all is friendly" steer; capped at 5 per
 *   direct user feedback (the full first page was too much for a "here's
 *   what you just did" default).
 *
 * All data hooks key off `debouncedQ`/`parsedDebounced`, never the raw
 * per-keystroke `q` — the visible input itself is never debounced. The
 * RESULTS returned here are additionally smoothed through `useStableResults`
 * (below) so a debounce/fetch cycle never blanks the list mid-type.
 */
function usePaletteResults(
  parsed: ReturnType<typeof useCommandPalette>['parsed'],
  parsedDebounced: ReturnType<typeof useCommandPalette>['parsedDebounced'],
  scope: PaletteScope,
): { results: CommandPaletteResult[]; showTagSuggestions: boolean; isFullyEmpty: boolean } {
  const { data: tagsData } = useTags();
  const allTags = tagsData?.tags ?? [];

  const { isTrashScope, routeTag, showTagSuggestions, settledTag, searchText, trashHasText } =
    derivePaletteMode(parsedDebounced, scope);
  const tagPrefix = (parsed.partialTag ?? parsedDebounced.partialTag ?? '').toLowerCase();
  const matchingTags = useMemo(
    () =>
      showTagSuggestions ? allTags.filter((t) => t.name.toLowerCase().startsWith(tagPrefix)) : [],
    [showTagSuggestions, allTags, tagPrefix],
  );

  const hasText = searchText.trim().length > 0;
  const hasSettledTag = !isTrashScope && settledTag !== undefined && settledTag.length > 0;

  const searchQuery = useSearchLinks(
    !isTrashScope && hasText ? searchText : '',
    hasSettledTag ? settledTag : undefined,
  );
  const tagOnlyQuery = useLinksByTag(hasSettledTag && !hasText ? settledTag : undefined);
  // Each scope's "recent" fallback list is gated to the scope it belongs to
  // (perf: palette-open over-fetch) — opening the palette on the LIBRARY page
  // no longer eagerly fetches `/api/trash`, and opening it on TRASH no longer
  // fetches `/api/links`. Only the current scope's recents are shown before you
  // type; the other scope's list loads if/when you switch to it.
  const recentQuery = useInfiniteLinks(isTrashScope ? undefined : routeTag, {
    enabled: !isTrashScope,
  });

  const trashSearchQuery = useSearchTrash(trashHasText ? parsedDebounced.text : '');
  const trashRecentQuery = useTrashList({ enabled: isTrashScope });

  const isFullyEmpty = !showTagSuggestions && !hasText && !hasSettledTag && !trashHasText;

  const { linkResults, isSettling } = selectScopedResults({
    isTrashScope,
    showTagSuggestions,
    isFullyEmpty,
    library: { hasText, hasSettledTag, searchQuery, tagOnlyQuery, recentQuery },
    trash: { hasText: trashHasText, searchQuery: trashSearchQuery, recentQuery: trashRecentQuery },
  });

  const rawResults: CommandPaletteResult[] = showTagSuggestions
    ? matchingTags.map((tag) => ({ kind: 'tag', tag }) as const)
    : linkResults.map((link) => ({ kind: 'link', link }) as const);

  const results = useStableResults(rawResults, isSettling);

  return { results, showTagSuggestions, isFullyEmpty };
}

/**
 * The pure "which mode is the palette in" derivation — split out of
 * `usePaletteResults` (which otherwise trips the lint's cognitive-complexity
 * ceiling once scope-awareness is added on top of the pre-existing
 * tag-suggestion/settled-tag branching) so it's a plain, hook-free function
 * `usePaletteResults` can call inline. Takes ONLY the debounced parse —
 * `usePaletteResults` itself still reads the raw `parsed.partialTag` for the
 * tag-prefix CLIENT-SIDE filter text (see that hook's own doc comment for
 * why THAT one input stays instant-reactive while everything query-affecting
 * here goes through the debounced value); this function only relocates the
 * debounced-mode computation, not the raw-vs-debounced reasoning itself.
 */
function derivePaletteMode(
  parsedDebounced: ReturnType<typeof useCommandPalette>['parsedDebounced'],
  scope: PaletteScope,
): {
  isTrashScope: boolean;
  routeTag: string | undefined;
  showTagSuggestions: boolean;
  settledTag: string | undefined;
  searchText: string;
  trashHasText: boolean;
} {
  const isTrashScope = scope.kind === 'trash';
  const routeTag = scope.kind === 'tag' ? scope.tag : undefined;
  const showTagSuggestions = !isTrashScope && parsedDebounced.partialTag !== undefined;

  // The tag actually used to SCOPE the query: the user's own explicit
  // `#tag` wins when present; otherwise, on a `/tags/:name` page, the
  // route's own tag is the implicit scope. Never applies in trash scope (no
  // tag concept there at all — see `usePaletteResults`'s doc comment).
  const settledTag = showTagSuggestions ? undefined : (parsedDebounced.tag ?? routeTag);
  const searchText = showTagSuggestions ? '' : parsedDebounced.text;
  const trashHasText =
    isTrashScope && !showTagSuggestions && parsedDebounced.text.trim().length > 0;

  return { isTrashScope, routeTag, showTagSuggestions, settledTag, searchText, trashHasText };
}

/** The trash-scope link-results source-picking branch — mirrors `selectLinkResults` but over the two trash-only hooks (`useSearchTrash`/`useTrashList`), since trash has no tag-scoped view to pick between. */
function selectTrashResults(args: {
  hasText: boolean;
  searchResults: TrashSearchResultJson[] | undefined;
  recentResults: TrashLinkJson[] | undefined;
}): PaletteLinkResult[] {
  if (args.hasText) return args.searchResults ?? [];
  return args.recentResults ?? [];
}

/** The link-results source-picking branch, split out of `usePaletteResults` purely to keep both functions under the lint's cognitive-complexity ceiling. */
function selectLinkResults(args: {
  hasText: boolean;
  hasSettledTag: boolean;
  isFullyEmpty: boolean;
  searchResults: SearchResultJson[] | undefined;
  tagResults: LinkJson[] | undefined;
  recentResults: LinkJson[] | undefined;
}): PaletteLinkResult[] {
  if (args.hasText) return args.searchResults ?? [];
  if (args.hasSettledTag) return args.tagResults ?? [];
  if (args.isFullyEmpty) return args.recentResults ?? [];
  return [];
}

/**
 * Picks between the LIBRARY/TAG-scope query trio (`useSearchLinks`/
 * `useLinksByTag`/`useInfiniteLinks`) and the TRASH-scope pair
 * (`useSearchTrash`/`useTrashList`) for both the visible `linkResults` AND
 * the `isSettling` flag together — split out of `usePaletteResults` purely
 * to keep that function's own cognitive complexity under the lint ceiling
 * (same motive as `selectLinkResults`/`selectIsSettling` themselves; this is
 * the scope-level ternary that picks WHICH of those two helper calls runs,
 * pulled out so `usePaletteResults` doesn't also carry that branching
 * inline). All five hook results are threaded straight through — every
 * `.data`/`.isPending` read here is a cheap field access, not a fresh call.
 */
function selectScopedResults(args: {
  isTrashScope: boolean;
  showTagSuggestions: boolean;
  isFullyEmpty: boolean;
  library: {
    hasText: boolean;
    hasSettledTag: boolean;
    searchQuery: ReturnType<typeof useSearchLinks>;
    tagOnlyQuery: ReturnType<typeof useLinksByTag>;
    recentQuery: ReturnType<typeof useInfiniteLinks>;
  };
  trash: {
    hasText: boolean;
    searchQuery: ReturnType<typeof useSearchTrash>;
    recentQuery: ReturnType<typeof useTrashList>;
  };
}): { linkResults: PaletteLinkResult[]; isSettling: boolean } {
  if (args.showTagSuggestions) return { linkResults: [], isSettling: false };

  if (args.isTrashScope) {
    return {
      linkResults: selectTrashResults({
        hasText: args.trash.hasText,
        searchResults: args.trash.searchQuery.data?.results,
        recentResults: args.trash.recentQuery.data?.links?.slice(0, RECENT_DEFAULT_COUNT),
      }),
      isSettling: selectIsSettling({
        showTagSuggestions: false,
        hasText: args.trash.hasText,
        hasSettledTag: false,
        isFullyEmpty: args.isFullyEmpty,
        searchPending: args.trash.searchQuery.isPending,
        tagOnlyPending: false,
        recentPending: args.trash.recentQuery.isPending,
      }),
    };
  }

  return {
    linkResults: selectLinkResults({
      hasText: args.library.hasText,
      hasSettledTag: args.library.hasSettledTag,
      isFullyEmpty: args.isFullyEmpty,
      searchResults: args.library.searchQuery.data?.results,
      tagResults: args.library.tagOnlyQuery.data?.links,
      recentResults: args.library.recentQuery.data?.pages[0]?.links?.slice(0, RECENT_DEFAULT_COUNT),
    }),
    isSettling: selectIsSettling({
      showTagSuggestions: false,
      hasText: args.library.hasText,
      hasSettledTag: args.library.hasSettledTag,
      isFullyEmpty: args.isFullyEmpty,
      searchPending: args.library.searchQuery.isPending,
      tagOnlyPending: args.library.tagOnlyQuery.isPending,
      recentPending: args.library.recentQuery.isPending,
    }),
  };
}

/**
 * "Settling" = the query backing the CURRENT mode is still on its first (or
 * a re-keyed) fetch with no data yet — the exact window where blanking to
 * empty would read as flicker (`useStableResults`, above, holds the previous
 * results while this is true). Split out of `usePaletteResults` purely to
 * keep both functions under the lint's cognitive-complexity ceiling, same as
 * `selectLinkResults`. Tag suggestions are filtered client-side off
 * `useTags()` (already-loaded data, no per-keystroke fetch), so they're
 * never "settling" in this sense. `*Pending` (v5 `isPending` — no cached
 * data at all for this query key) is used over `isFetching` deliberately:
 * refetches of an ALREADY-populated key (e.g. the recent list's background
 * poll) should keep showing that query's own fresh data immediately, not
 * fall back to a stale snapshot from a previous render.
 */
function selectIsSettling(args: {
  showTagSuggestions: boolean;
  hasText: boolean;
  hasSettledTag: boolean;
  isFullyEmpty: boolean;
  searchPending: boolean;
  tagOnlyPending: boolean;
  recentPending: boolean;
}): boolean {
  if (args.showTagSuggestions) return false;
  if (args.hasText) return args.searchPending;
  if (args.hasSettledTag) return args.tagOnlyPending;
  if (args.isFullyEmpty) return args.recentPending;
  return false;
}

/**
 * The floating, keyboard-first command center (plan 024, rebuilt on `cmdk`
 * per the "make it a proper top-centered wide palette" pass) — mounted ONCE
 * at the app root (`AppFrame.tsx`), driven entirely by `useCommandPalette()`'s
 * state. `usePaletteResults` above still owns every bit of the query-model
 * branching; this component's job shrank to: render the scrim/panel shell
 * (custom here, NOT `ModalShell` — see below) and hand the resolved
 * `results` to `cmdk`'s `<Command>`/`<Command.Input>`/`<Command.List>`/
 * `<Command.Item>` primitives, which take over keyboard nav (↑↓/Enter),
 * `aria-activedescendant`/listbox a11y, and active-item highlighting for
 * free — code this component used to hand-roll (`moveActive`,
 * `clampedActiveIndex`, `optionId`, `paletteRowStyle`'s active branch) is
 * now cmdk's problem, not ours.
 *
 * Why NOT `<Command.Dialog>` (cmdk's own Radix-based dialog wrapper): it
 * mounts its own Radix `Dialog.Root`/`Dialog.Overlay`/`Dialog.Content` with
 * their own focus-trap/Escape/portal behavior, which would run ALONGSIDE
 * (not replace) `RowMenuLayer`'s existing mutual-exclusion effects — those
 * effects close the palette imperatively via `palette.closePalette()`
 * whenever Edit/Settings opens, and there's no clean way to also puppet a
 * separate Radix-owned open state from outside. Keeping the SAME
 * `open ? render : null` shape `ModalShell` used (just with different scrim/
 * panel chrome — top-anchored + wide, not centered) means every mutual-
 * exclusion effect in `AppFrame.tsx`'s `RowMenuLayer` keeps working
 * unmodified: they all just call `palette.closePalette()`, which flips
 * `open` to `false`, which unmounts this component's return value — exactly
 * like before. The panel below reimplements only the pieces `ModalShell`
 * provided that a top-anchored dialog still needs: the scrim, `role="dialog"`
 * + `aria-modal`, a capture-phase Escape listener 1-to-1 with `ModalShell`'s
 * own, and click-outside-to-close. Focus-trap/Tab-cycling is NOT reimplemented
 * here — `Command.Input` is the sole focusable control in the panel (result
 * rows are `Command.Item`s, not native buttons/links, so Tab has nothing else
 * to cycle to), so trapping Tab would be dead code.
 *
 * Thin `open`-gated wrapper (perf fix, dedupe-api-calls slice unit 1): this
 * component is mounted PERMANENTLY at the app root, so if it called
 * `usePaletteResults` itself, that hook's data subscriptions
 * (`useInfiniteLinks`/`useTrashList`/`useTags`/`useSearchLinks`/
 * `useLinksByTag`/`useSearchTrash`) would run on EVERY page — React runs all
 * hooks before an early `if (!open) return null`, so an early return here
 * can't gate them. Instead the data-hook-bearing work is pushed into
 * `CommandPaletteInner`, which this wrapper mounts ONLY when `open` — closed,
 * nothing below this line ever renders, so none of those queries subscribe
 * (no phantom `/api/links` poll on `/trash`, no phantom `/api/trash` on `/`
 * or `/tags/*`). The capture-phase Escape listener stays HERE rather than
 * moving into the inner: it needs to be armed the instant `open` flips true
 * (same render that mounts the inner), and its own `if (!open) return`
 * guard already makes it a no-op while closed, so keeping it in the wrapper
 * is behavior-identical to before the split.
 */
export function CommandPalette({ palette }: { palette: ReturnType<typeof useCommandPalette> }) {
  const { open, closePalette } = palette;
  const { dismissAll } = useHoverPreview();

  // Opening the palette (⌘K / `/`) is a full-screen takeover — dismiss any
  // library-row hover card that's still showing (review: ce-julik-frontend-
  // races). Without this, a keyboard-only open while a library row is hovered
  // leaves that card floating under the palette's scrim until an incidental
  // pointer move triggers the `pointermove` fallback. Mirrors the existing
  // Settings/Edit mutual-exclusion pattern in `RowMenuLayer`. Runs on the
  // `open` edge; a no-op when nothing is showing.
  useEffect(() => {
    if (open) dismissAll();
  }, [open, dismissAll]);

  // Mirrors `ModalShell`'s own capture-phase Escape listener 1-to-1 (see that
  // component's doc comment for why capture-phase: it must win over
  // `AppFrame`'s bubble-phase `RowMenuLayer` listener and any other, since
  // this is always the topmost overlay while open). Not reusing `ModalShell`
  // itself here — see the component doc comment above for why the shell had
  // to be reimplemented rather than shared for this layout.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closePalette();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, closePalette]);

  if (!open) return null;

  return <CommandPaletteInner palette={palette} />;
}

/**
 * Keyboard-nav hover (palette-keyboard-hover slice), extracted as a named hook
 * to match this file's own convention (`usePaletteResults`/`useStableResults`)
 * of keeping self-contained derived-state logic out of `CommandPaletteInner`'s
 * body. Owns the controlled cmdk active value and drives the shared hover
 * card off it. Returns `[activeValue, setActiveValue]` to wire onto
 * `<Command value onValueChange>`.
 *
 * `onValueChange` fires for BOTH arrow-key navigation AND pointer movement
 * (cmdk's `Item` has an `onPointerMove` that sets the active value;
 * `disablePointerSelection` defaults false) — so this is NOT keyboard-only, and
 * it MUST apply the same `isHoverCapable()` touch guard the mouse
 * `handleEnter` uses (review: ce-correctness). Without it, a touch/coarse-
 * pointer tap onto an enabled row would fire this effect and open a card the
 * pointer path deliberately suppresses (and the two would race). With the guard,
 * both the pointer-driven `onValueChange` here and the row's own
 * `handleEnter`/`handleLeave` agree, and arrow-key nav on a real
 * (hover-capable) desktop still shows the card as intended.
 *
 * When the active row is a tag row, a gate-suppressed link, resolves to
 * nothing after a results swap, or cmdk collapses the value to '' (empty
 * result set), the card is DISMISSED rather than left stranded (review:
 * ce-julik-frontend-races — an earlier `!activeValue` early-return skipped both
 * branches and stranded a pending/open card).
 */
function usePaletteKeyboardHover(
  results: readonly CommandPaletteResult[],
  panelRef: React.RefObject<HTMLDivElement | null>,
  plugins: SettingsMap['plugins'] | undefined,
): [string, (value: string) => void] {
  const { scheduleShow, dismissAll } = useHoverPreview();
  const [activeValue, setActiveValue] = useState('');

  // Map an active cmdk value (`link:<id>` / `tag:<name>`) back to its result.
  // Rebuilt when `results` changes (identity of the visible set).
  const resultByValue = useMemo(() => {
    const m = new Map<string, CommandPaletteResult>();
    for (const result of results) m.set(resultValue(result), result);
    return m;
  }, [results]);

  useEffect(() => {
    const result = activeValue ? resultByValue.get(activeValue) : undefined;
    // No enabled link row to preview → dismiss any showing/pending card.
    if (
      result?.kind !== 'link' ||
      !palettePluginOn(result.link.sourceData.kind, plugins) ||
      // Touch/coarse-pointer: no hover affordance (mirrors the mouse path's own
      // `isHoverCapable()` suppress). See this hook's doc comment.
      !isHoverCapable()
    ) {
      dismissAll();
      return;
    }
    // `CSS.escape` guards ids/values containing characters that would break the
    // attribute selector (ids are UUIDs today, but the value is `link:<id>` and
    // this stays correct if id shape ever changes). Reads the active row's rect
    // straight from the DOM node cmdk marked active, after React committed the
    // new value (so the row is already scrolled into view).
    const node = panelRef.current?.querySelector<HTMLElement>(
      `[cmdk-item][data-value="${CSS.escape(activeValue)}"]`,
    );
    if (!node) return; // not yet in the DOM this tick; a later change re-runs
    scheduleShow(result.link, node.getBoundingClientRect());
  }, [activeValue, resultByValue, plugins, panelRef, scheduleShow, dismissAll]);

  return [activeValue, setActiveValue];
}

/**
 * Everything that needs `open` to actually be true — split out of
 * `CommandPalette` (see that component's doc comment) purely so its data
 * hooks (`usePaletteScope`/`usePaletteResults`) never mount while the
 * palette is closed. Not exported: `CommandPalette` above is the only
 * public surface, this is an implementation detail of the open-gating.
 * Reads `open`/`closePalette` back off `palette` (rather than trusting the
 * wrapper's own `if (!open) return null` implicitly) only for `closePalette`
 * — `open` itself is guaranteed true by the wrapper, this component never
 * needs to branch on it again.
 */
function CommandPaletteInner({ palette }: { palette: ReturnType<typeof useCommandPalette> }) {
  const { closePalette, q, setQ, parsed, parsedDebounced } = palette;
  const scope = usePaletteScope();
  const { results, showTagSuggestions, isFullyEmpty } = usePaletteResults(
    parsed,
    parsedDebounced,
    scope,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const { data: settings } = useSettings();
  const [activeValue, setActiveValue] = usePaletteKeyboardHover(
    results,
    panelRef,
    settings?.plugins,
  );

  const openLinkResult = (link: PaletteLinkResult) => {
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

  const onSelectResult = (result: CommandPaletteResult) => {
    if (result.kind === 'link') {
      openLinkResult(result.link);
    } else {
      applyTagSuggestion(result.tag);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim dismiss is pointer-only convenience — Escape (the capture-phase document listener above) is the keyboard-equivalent close path, matching ModalShell's own scrim.
    // biome-ignore lint/a11y/noStaticElementInteractions: same — a non-interactive click guard, not a control.
    <div
      onClick={closePalette}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim)',
        // Frosted-glass backdrop, matching the modal shell — the app blurs
        // behind the palette so it clearly floats above a defocused page.
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'center',
        // `flex-start` (NOT the default `stretch`): the scrim is a flex row, so
        // its cross-axis is vertical — without this the panel stretches to the
        // full scrim height and the result list shows a big empty region below
        // it (user feedback). `flex-start` lets the panel take its natural
        // content height (capped at maxHeight:70vh) so it hugs the results.
        alignItems: 'flex-start',
        // Top-anchored, not centered (the redesign's whole point): ~17vh
        // down from the viewport top, the standard command-palette resting
        // position (Linear/Raycast/VS Code Quick Open) rather than a
        // vertically-centered modal — a palette is a fleeting, glanceable
        // overlay, not a form you settle into, so it reads better docked
        // near where the eye already is (top of screen, near the app chrome)
        // than dead-center over whatever content was showing.
        paddingTop: '17vh',
        zIndex: 40,
        animation: 'siloFade .16s var(--ease-out)',
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: this onClick is a stopPropagation guard (not a control) that keeps the scrim's onClick above from closing when clicking inside the panel — no interactive semantics of its own; role="dialog" below already gives this element real a11y semantics. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        style={{
          // Wide top-centered panel (~640px) — deliberately wider than
          // `ModalShell`'s form modals (520/560px): those hold narrow label+
          // input rows, this holds a scannable list of title+domain rows
          // that wants the extra horizontal room.
          width: 640,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--line)',
          borderRadius: 14,
          background: 'var(--bg)',
          boxShadow: 'var(--elev-3)',
          boxSizing: 'border-box',
          overflow: 'hidden',
          animation: 'siloIn .2s var(--ease-out)',
        }}
      >
        <Command
          shouldFilter={false}
          label="Command palette"
          loop
          value={activeValue}
          onValueChange={setActiveValue}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s2-5)',
              padding: 'var(--s4) var(--s5)',
              borderBottom: '1px solid var(--line)',
              flex: 'none',
            }}
          >
            {/* Type-to-refocus (palette-keyboard-hover slice): the requirement
                "typing while a row is focused returns focus to the input" is
                satisfied INHERENTLY by cmdk's focus model — its rows are
                `role="option"` (never focusable), so DOM focus stays on this
                input through all arrow navigation (verified in browser QA:
                `document.activeElement` is this `[cmdk-input]` after ArrowDown,
                and a keystroke lands in `value`). No keydown-refocus handler is
                added because there is no reachable state where a printable key
                lands anywhere but here — such a handler could never fire, and
                dead code is worse than none. If a future change makes rows
                focusable, add the bare-printable → `inputRef.current.focus()`
                guard then (see the keyboard-hover design doc). */}
            <Command.Input
              ref={palette.inputRef}
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder={scopePlaceholder(scope)}
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                background: 'none',
                outline: 'none',
                font: 'inherit',
                fontSize: 'var(--text-md)',
                color: 'var(--ink)',
                padding: 0,
              }}
            />
          </div>

          <Command.List
            label={showTagSuggestions ? 'Matching tags' : 'Matching links'}
            style={{
              overflowY: 'auto',
              padding: 'var(--s2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Command.Empty>
              <div
                style={{
                  padding: 'var(--s6) var(--s4)',
                  textAlign: 'center',
                  fontSize: 'var(--text-base)',
                  color: 'var(--fnt)',
                }}
              >
                {isFullyEmpty
                  ? scope.kind === 'trash'
                    ? 'Type to search trash'
                    : 'Type to search links and #tags'
                  : showTagSuggestions
                    ? 'No matching tags'
                    : 'No results'}
              </div>
            </Command.Empty>

            {results.map((result) => (
              <Command.Item
                key={resultValue(result)}
                value={resultValue(result)}
                onSelect={() => onSelectResult(result)}
                className="silo-palette-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  boxSizing: 'border-box',
                  textAlign: 'left',
                  padding: 'var(--s2) var(--s3)',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                {result.kind === 'link' ? (
                  <PaletteLinkRow link={result.link} />
                ) : (
                  <PaletteTagRow tag={result.tag} />
                )}
              </Command.Item>
            ))}
          </Command.List>

          {results.length > 0 && (
            <div
              style={{
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s4)',
                padding: 'var(--s2) var(--s5)',
                borderTop: '1px solid var(--line)',
                fontSize: 'var(--text-xs)',
                color: 'var(--fnt)',
              }}
            >
              {/* Each hint is a flex pair so the glyph and its label share ONE
                  vertical center (user feedback: the ↑↓/↵ glyphs floated off
                  the text baseline). The glyph sits in a fixed-height key-cap
                  with line-height:1, so its own font metrics can't drag it
                  above/below the label beside it. */}
              <PaletteHint glyph="↑↓" label="navigate" />
              <PaletteHint glyph="↵" label={showTagSuggestions ? 'apply' : 'open'} />
              <PaletteHint glyph="esc" label="close" />
            </div>
          )}
        </Command>
      </div>
    </div>
  );
}
