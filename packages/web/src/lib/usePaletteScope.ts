import { useMatch } from 'react-router';

/**
 * The command palette's page-scoping (direct user decision, post-cmdk-
 * rebuild): the palette now searches the surface the user is CURRENTLY
 * looking at rather than always the whole Library, replacing the top
 * search boxes those pages used to have (`Omnibar`'s search half on
 * Library, `TrashSearchInput` on Trash — both being removed by a separate
 * unit; this hook is what lets the palette absorb their job).
 *
 * - `/` (Library) -> `{ kind: 'library' }` — the palette's original,
 *   unscoped behavior (search/list the whole live set).
 * - `/trash` -> `{ kind: 'trash' }` — the palette searches TRASHED links via
 *   the trash-only endpoints (`useSearchTrash`/`useTrashList`), never the
 *   live Library.
 * - `/tags/:name` -> `{ kind: 'tag', tag: name }` — the palette's implicit
 *   scope becomes that tag: an empty query shows that tag's recent links,
 *   plain text searches WITHIN that tag. The user's own `#othertag` typed
 *   into the palette still overrides this (see `CommandPalette.tsx`'s
 *   `usePaletteResults` — an explicit parsed `tag`/`partialTag` always wins
 *   over the route's implicit one), so `#tag` autocomplete/switching keeps
 *   working exactly as before on top of the page scope.
 * - Anything else (Settings, 404, …) -> `{ kind: 'library' }`, the same
 *   fallback as "no route matched" — there's no page-native search surface
 *   to scope to, so the palette falls back to its original whole-Library
 *   behavior rather than searching nothing.
 *
 * A thin wrapper over `useMatch` (not `useLocation` + manual string
 * parsing) so the scope can never drift from `App.tsx`'s actual route
 * definitions — a route rename there is a compile-time-visible change here
 * too, not a silently-stale string prefix check.
 */
export type PaletteScope = { kind: 'library' } | { kind: 'trash' } | { kind: 'tag'; tag: string };

export function usePaletteScope(): PaletteScope {
  const trashMatch = useMatch('/trash');
  const tagMatch = useMatch('/tags/:name');

  if (trashMatch) return { kind: 'trash' };
  if (tagMatch?.params.name) return { kind: 'tag', tag: decodeURIComponent(tagMatch.params.name) };
  return { kind: 'library' };
}
