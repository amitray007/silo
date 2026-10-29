# Title scramble when enrichment finishes

**Status: approved at gate 1 (2026-10-29).**

## Request (Amit, 2026-10-29)

When enrichment prepares a title, show it with the "basic text scramble" from
motion-primitives (<https://motion-primitives.com/docs/text-scramble>). It applies to
every enrichment, AI title or not.

## Behavior

- **When:** a list row's title changes on screen because enrichment finished. Example:
  a pasted X post shows "Pedro Duarte (@peduarte) on X" or its URL, then scrambles
  into the AI title. The same applies to a page title on a normal link.
- **Never:** on first load, on scroll or remount of a row the user already saw settle,
  on a title the owner edited, or when the title did not change.
- **Where:** the title in the library list row only. The reader header, the ⌘K palette
  and the hover card show the final title without animation.
- **Feel:** about 0.8 s. Characters settle left to right, and unsettled characters
  cycle through a set of letters and digits every 40 ms, matching the motion-primitives
  defaults (`duration 0.8`, `speed 0.04`). Spaces stay spaces.
- **Scripts:** the scramble works on grapheme clusters (`Intl.Segmenter`). A title that
  contains letters outside Latin, Greek and Cyrillic (for example Japanese or Hindi)
  fades in over 200 ms instead, because random Latin letters inside those scripts look
  broken.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, the title swaps with no
  animation.
- **Accessibility:** the accessible name is always the final title. The scrambling
  characters are `aria-hidden`.

## Shape

- No new dependency. Silo does not use `motion`, so a small hook and component do the
  work: `useTitleReveal` and `ScrambleText` in `packages/web/src/components/`, or in
  `lib/` if a hook folder exists.
- **Trigger rule:** local web mutations register pending reveals in a module-level
  store. Each entry expires after two minutes; the store holds at most 256 entries
  and prunes on access. Capture registers its temporary id, then transfers the
  pending reveal to the server id using the title shown at save time (URL,
  placeholder or existing mounted row title). A registry tracks mounted row ids
  and titles, and removes them on unmount. A visible temporary row can hand its
  reveal to an unmounted server id, even when that id is cached in another tag
  and enrichment has already finished. Cached rows do not set the baseline or
  block the handoff. Enrich registers the link id with the clicked row's displayed
  title, or the mounted row's title for other callers. A failed Re-enrich restores
  the prior pending entry with its original expiry unless a later action replaced
  or consumed the new entry. A title edit clears the pending reveal and
  leaves an expiring edit marker so a late capture response cannot animate it.
  A mounted row consumes its entry when a different title is settled, and plays
  once. It waits while enriching. A transition from enriching to settled with the
  same title consumes the entry without animation. Dedup re-saves can stay `full`;
  an unchanged save response waits for a title change or expiry because it does
  not report enrichment completion. First loads and remounts never play, except
  the explicit temporary-to-server handoff. Changes from another tab or MCP have
  no local pending entry and do not animate. Changing reduced motion after a
  reveal finishes, stops or is skipped never replays it.
- **Performance:** only rows that change animate. Use one `requestAnimationFrame` loop
  per animating row and cancel it on unmount. Rows keep their truncation and height,
  so the list must not shift.

## Checks

- Unit tests with fake timers: plays on fast capture, dedup re-save and Enrich with a new title; no play
  on first load, on remount, on an edit, or on the same title; checks expiry and the
  size cap; does not replay after reduced motion changes; fades for Japanese and
  Hindi; no animation with reduced motion; the accessible name is the final title.
- Browser QA on 8797: paste real X posts and a normal link with AI on and off, and
  watch the rows in dark and light themes at desktop and phone widths.
