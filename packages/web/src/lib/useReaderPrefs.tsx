import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { apiPatchKeepalive } from '../api/client';
import { useUpdateReaderPrefs } from '../api/hooks';
import type { LinkJson } from '../api/types';
import {
  type ReadAloudEngine,
  type ReadAloudPrefs,
  type ReaderSettings,
  readerTypeStyle,
  STEPPER_DELAY_MS,
  useReaderDefaults,
} from './readerPrefs';
import { createSync, type DeepPartial, mergeDeep } from './readerSync';

type Overrides = DeepPartial<ReaderSettings>;

function createArticle(initial: Overrides, sessionOnly = false) {
  let value = initial;
  const listeners = new Set<() => void>();
  const replace = (next: Overrides) => {
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    value = next;
    for (const listener of listeners) listener();
  };
  const sync = createSync<Overrides>({
    read: () => value,
    apply: (patch) => replace(mergeDeep(value, patch)),
    replace,
    hasLocal: () => false,
  });
  let disconnect: (() => void) | undefined;
  return {
    sessionOnly,
    connect(transport: Parameters<typeof sync.connect>[0]) {
      disconnect?.();
      disconnect = sync.connect(transport, true);
      return disconnect;
    },
    sync,
    read: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    session: (patch: Overrides) => replace(mergeDeep(value, patch)),
  };
}

// Feed choices last for this page session only. Library entries retain pending writes on navigation.
const articles = new WeakMap<QueryClient, Map<string, ReturnType<typeof createArticle>>>();
const ArticleContext = createContext<ReturnType<typeof createArticle> | null>(null);

function articleFor(client: QueryClient, link: LinkJson) {
  let entries = articles.get(client);
  if (!entries) {
    entries = new Map();
    articles.set(client, entries);
  }
  let entry = entries.get(link.id);
  if (!entry) {
    entry = createArticle(link.readerPrefs ?? {}, link.feedId != null);
    entries.set(link.id, entry);
  }
  return entry;
}

/** Mount once around an article. Hydrate before paint when its detail arrives. */
export function ReaderPrefsProvider({ link, children }: { link: LinkJson; children: ReactNode }) {
  const article = articleFor(useQueryClient(), link);
  const update = useUpdateReaderPrefs(link.id);
  const feed = link.feedId != null;
  useLayoutEffect(() => {
    if (!feed && link.readerPrefs !== undefined) article.sync.hydrate(link.readerPrefs);
  }, [article, feed, link.readerPrefs]);
  useEffect(() => {
    if (feed) return;
    return article.connect({
      send: update,
      keepalive: (patch) =>
        apiPatchKeepalive(`/api/links/${encodeURIComponent(link.id)}/reader-prefs`, patch),
    });
  }, [article, feed, link.id, update]);
  // Disconnect after queued edits settle, including a final stepper change on navigation.
  return <ArticleContext.Provider value={article}>{children}</ArticleContext.Provider>;
}

const emptyArticle = createArticle({});

/** Effective defaults plus this article's leaves. Every in-article setter writes only its override. */
export function useReaderPrefs() {
  const article = useContext(ArticleContext);
  const defaults = useReaderDefaults();
  const overrides = useSyncExternalStore(
    (article ?? emptyArticle).subscribe,
    (article ?? emptyArticle).read,
    (article ?? emptyArticle).read,
  );
  const prefs = useMemo(() => mergeDeep(defaults, overrides), [defaults, overrides]);
  const update = useCallback(
    (patch: Overrides, delay = 0) => {
      // Outside an article this hook is read-only; Settings uses its defaults hooks explicitly.
      if (!article) return;
      if (article.sessionOnly) article.session(patch);
      else article.sync.commit(patch, delay);
    },
    [article],
  );
  const style = useMemo(() => readerTypeStyle(prefs.type), [prefs.type]);
  return { prefs, update, style };
}

export function useArticleReadAloudPrefs() {
  const { prefs, update } = useReaderPrefs();
  const change = useCallback(
    (patch: Partial<Omit<ReadAloudPrefs, 'voices'>> & { voice?: [ReadAloudEngine, string] }) => {
      const { voice, ...rest } = patch;
      update(
        { readAloud: { ...rest, ...(voice ? { voices: { [voice[0]]: voice[1] } } : {}) } },
        'rate' in rest ? STEPPER_DELAY_MS : 0,
      );
    },
    [update],
  );
  return { prefs: prefs.readAloud, update: change };
}
