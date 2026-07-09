import { List } from '@raycast/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browseLinks, CaptureError, getCounts, listTags, listTrash } from './lib/capture-client.js';
import { LinkActions } from './lib/link-actions.js';
import { LinkDetail } from './lib/link-detail.js';
import { getBaseUrl } from './lib/preferences.js';
import { groupByDay } from './lib/search-grouping.js';
import { domainOf, sourceIcon } from './lib/source-icon.js';
import type { CapturedLink, TagWithCount, TrashLink } from './lib/types.js';

/** The scope dropdown's selection — "Library" (whole live library), "Trash", or a specific tag (design spec CMD 4: "Library (default) · Trash · a specific tag"). */
export type Scope = 'library' | 'trash' | `tag:${string}`;

/** The dropdown/section label for a scope — pure so it's testable without rendering. */
export function scopeLabel(scope: Scope): string {
  if (scope === 'library') return 'Library';
  if (scope === 'trash') return 'Trash';
  return scope.slice('tag:'.length);
}

/** Days remaining before a trashed link purges, floored at 0 (an overdue purge never shows negative days) — `deletedAt` + `purgeWindowDays` from `GET /api/counts`. */
export function daysUntilPurge(
  deletedAt: string,
  purgeWindowDays: number,
  now = new Date(),
): number {
  const deleted = new Date(deletedAt).getTime();
  const purgeAt = deleted + purgeWindowDays * 24 * 60 * 60 * 1000;
  const msLeft = purgeAt - now.getTime();
  return Math.max(0, Math.round(msLeft / (24 * 60 * 60 * 1000)));
}

type BrowseState = {
  links: CapturedLink[];
  trashLinks: TrashLink[];
  isLoading: boolean;
  /** null until `GET /api/counts` resolves — so the trash countdown never paints a wrong (default) retention window before the real one loads. */
  purgeWindowDays: number | null;
};

/** Fetches the current scope's rows — Library/tag from `browseLinks`, Trash from `listTrash`, per the design spec's scope→endpoint mapping. */
async function fetchScope(
  scope: Scope,
): Promise<{ links: CapturedLink[]; trashLinks: TrashLink[] }> {
  if (scope === 'trash') {
    const { links } = await listTrash();
    return { links: [], trashLinks: links };
  }
  const tag = scope.startsWith('tag:') ? scope.slice('tag:'.length) : undefined;
  const { links } = await browseLinks(tag ? { tag } : {});
  return { links, trashLinks: [] };
}

/**
 * The whole-library surface (design spec CMD 4: "Browse Silo") — same
 * list+detail layout as Search, a scope dropdown (Library / Trash / each
 * tag), and the shared `⌘K` action panel, swapping to the trash variant
 * when scope is Trash.
 */
export default function Command() {
  const baseUrl = getBaseUrl();
  const [scope, setScope] = useState<Scope>('library');
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [state, setState] = useState<BrowseState>({
    links: [],
    trashLinks: [],
    isLoading: true,
    purgeWindowDays: null,
  });

  // Monotonic reload generation: a scope switch (Library→Trash→tag) fires
  // overlapping fetches, and without this guard whichever request RESOLVES
  // last wins — so a slow Library response can clobber the current Trash view
  // (empty-view on a full trash, or vice-versa). Each reload captures its own
  // generation; a response only commits if it's still the latest.
  const reloadGen = useRef(0);

  const reload = useCallback(async (currentScope: Scope) => {
    const gen = ++reloadGen.current;
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const [{ links, trashLinks }, counts] = await Promise.all([
        fetchScope(currentScope),
        currentScope === 'trash' ? getCounts() : Promise.resolve(undefined),
      ]);
      if (gen !== reloadGen.current) return; // a newer reload superseded this one
      setState((s) => ({
        links,
        trashLinks,
        isLoading: false,
        // Only carry a window when this reload actually loaded counts (trash
        // scope); leave null otherwise so the countdown never shows a stale
        // or default value.
        purgeWindowDays:
          counts?.purgeWindowDays ?? (currentScope === 'trash' ? s.purgeWindowDays : null),
      }));
    } catch (error) {
      if (gen !== reloadGen.current) return;
      const message = error instanceof CaptureError ? error.message : 'Could not load from silo';
      setState((s) => ({ ...s, isLoading: false }));
      console.error(message);
    }
  }, []);

  useEffect(() => {
    void reload(scope);
  }, [scope, reload]);

  useEffect(() => {
    void (async () => {
      try {
        setTags(await listTags());
      } catch {
        // The dropdown still works with Library/Trash if tags fail to load.
      }
    })();
  }, []);

  const isTrash = scope === 'trash';
  const hasResults = isTrash ? state.trashLinks.length > 0 : state.links.length > 0;
  const sections = isTrash ? [] : groupByDay(state.links);

  return (
    <List
      isLoading={state.isLoading}
      isShowingDetail={hasResults}
      searchBarAccessory={
        <List.Dropdown tooltip="Scope" value={scope} onChange={(v) => setScope(v as Scope)}>
          <List.Dropdown.Section>
            <List.Dropdown.Item title="Library" value="library" />
            <List.Dropdown.Item title="Trash" value="trash" />
          </List.Dropdown.Section>
          {tags.length > 0 && (
            <List.Dropdown.Section title="Tags">
              {tags.map((tag) => (
                <List.Dropdown.Item key={tag.name} title={tag.name} value={`tag:${tag.name}`} />
              ))}
            </List.Dropdown.Section>
          )}
        </List.Dropdown>
      }
    >
      {!hasResults && !state.isLoading ? (
        isTrash ? (
          <List.EmptyView title="Trash is empty" />
        ) : (
          <List.EmptyView
            title="Nothing here yet"
            description="Links you save to silo will show up here."
          />
        )
      ) : isTrash ? (
        <List.Section
          title={
            state.purgeWindowDays === null
              ? 'In trash'
              : `In trash · purges in ${state.purgeWindowDays} days`
          }
        >
          {state.purgeWindowDays !== null &&
            state.trashLinks.map((link) => (
              <BrowseTrashItem
                key={link.id}
                link={link}
                baseUrl={baseUrl}
                purgeWindowDays={state.purgeWindowDays as number}
                onChange={() => void reload(scope)}
              />
            ))}
        </List.Section>
      ) : (
        sections.map((section) => (
          <List.Section key={section.title} title={section.title}>
            {section.links.map((link) => (
              <BrowseLiveItem
                key={link.id}
                link={link}
                baseUrl={baseUrl}
                onChange={() => void reload(scope)}
                onFilterTag={(tag) => setScope(`tag:${tag}`)}
              />
            ))}
          </List.Section>
        ))
      )}
    </List>
  );
}

function BrowseLiveItem({
  link,
  baseUrl,
  onChange,
  onFilterTag,
}: {
  link: CapturedLink;
  baseUrl: string;
  onChange: () => void;
  onFilterTag: (tag: string) => void;
}) {
  const title = link.title?.trim() || domainOf(link.url);

  return (
    <List.Item
      title={title}
      subtitle={domainOf(link.url)}
      icon={sourceIcon(link)}
      accessories={link.captureStatus === 'enriching' ? [{ text: '◌ capturing' }] : []}
      detail={<LinkDetail link={link} baseUrl={baseUrl} />}
      actions={
        <LinkActions link={link} variant="live" onChange={onChange} onFilterTag={onFilterTag} />
      }
    />
  );
}

function BrowseTrashItem({
  link,
  baseUrl,
  purgeWindowDays,
  onChange,
}: {
  link: TrashLink;
  baseUrl: string;
  purgeWindowDays: number;
  onChange: () => void;
}) {
  const title = link.title?.trim() || domainOf(link.url);
  const daysLeft = daysUntilPurge(link.deletedAt, purgeWindowDays);

  return (
    <List.Item
      title={title}
      subtitle={domainOf(link.url)}
      icon={sourceIcon(link)}
      accessories={[{ text: `purges in ${daysLeft}d` }]}
      detail={<LinkDetail link={link} baseUrl={baseUrl} />}
      actions={<LinkActions link={link} variant="trash" onChange={onChange} />}
    />
  );
}
