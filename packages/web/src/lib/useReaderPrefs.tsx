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
import { queryKeys, useUpdateReaderPrefs } from '../api/hooks';
import type { LinkJson } from '../api/types';
import {
  type ReadAloudEngine,
  type ReadAloudPrefs,
  type ReaderSettings,
  readerTypeStyle,
  STEPPER_DELAY_MS,
  useReaderDefaults,
} from './readerPrefs';
import { advanceReaderPrefsVersion, readerPrefsVersion } from './readerPrefsVersion';
import { createSync, type DeepPartial, mergeDeep, type SyncTransport } from './readerSync';

type Overrides = DeepPartial<ReaderSettings>;

function createArticle(
  initial: Overrides,
  sessionOnly = false,
  onWrite = () => {},
  onIdle = (_value: Overrides) => {},
) {
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
    connect(transport?: SyncTransport<Overrides>) {
      disconnect?.();
      const released = () => {
        if (disconnect !== close) return;
        disconnect = undefined;
        // Strict Mode can reconnect the same scope before this turn ends.
        queueMicrotask(() => {
          if (disconnect === undefined) onIdle(value);
        });
      };
      const close = transport ? sync.connect(transport, true, released) : released;
      disconnect = close;
      return close;
    },
    sync,
    commit: (patch: Overrides, delay: number) => {
      onWrite();
      sync.commit(patch, delay);
    },
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
/** Active queues only; idle entries are reduced to preference snapshots after their final write. */
export function articleScopeCount(client: QueryClient): number {
  return articles.get(client)?.size ?? 0;
}

const saved = new WeakMap<QueryClient, Map<string, Overrides>>();
const ArticleContext = createContext<ReturnType<typeof createArticle> | null>(null);

/** These helpers never enter a provider's closure scope, which contains the full detail. */
function articleWrite(client: QueryClient, id: string) {
  return () => {
    advanceReaderPrefsVersion(client, id);
    void client.cancelQueries({ queryKey: queryKeys.link(id) });
  };
}

function articleTransport(id: string, send: SyncTransport<Overrides>['send']) {
  return {
    send,
    keepalive: (patch: Overrides, writtenAt: string) =>
      apiPatchKeepalive(`/api/links/${encodeURIComponent(id)}/reader-prefs`, {
        ...patch,
        writtenAt,
      }),
  };
}

function articleFor(client: QueryClient, id: string, initial: Overrides, sessionOnly: boolean) {
  let entries = articles.get(client);
  if (!entries) {
    entries = new Map();
    articles.set(client, entries);
  }
  let snapshots = saved.get(client);
  if (!snapshots) {
    snapshots = new Map();
    saved.set(client, snapshots);
  }
  let entry = entries.get(id);
  if (!entry) {
    const scopes = entries;
    const values = snapshots;
    entry = createArticle(
      values.get(id) ?? initial,
      sessionOnly,
      articleWrite(client, id),
      (value) => {
        // Only the small preferences survive navigation, never the sync queue or its transport.
        values.set(id, value);
        scopes.delete(id);
      },
    );
    // A stale detail may be rejected by the version guard on remount. The drained snapshot
    // still supplies a confirmed baseline, so a new edit can flush without waiting for a GET.
    if (values.has(id)) entry.sync.hydrate(entry.read());
    entries.set(id, entry);
  }
  return entry;
}

/** Mount once around an article. Hydrate before paint when its detail arrives. */
export function ReaderPrefsProvider({ link, children }: { link: LinkJson; children: ReactNode }) {
  const client = useQueryClient();
  const article = articleFor(client, link.id, link.readerPrefs ?? {}, link.feedId != null);
  const update = useUpdateReaderPrefs(link.id);
  const feed = link.feedId != null;
  useLayoutEffect(() => {
    if (
      !feed &&
      link.readerPrefs !== undefined &&
      (link.readerPrefsVersion ?? 0) >= readerPrefsVersion(client, link.id)
    ) {
      article.sync.hydrate(link.readerPrefs);
    }
  }, [article, client, feed, link.id, link.readerPrefs, link.readerPrefsVersion]);
  useEffect(
    () => article.connect(feed ? undefined : articleTransport(link.id, update)),
    [article, feed, link.id, update],
  );
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
      else article.commit(patch, delay);
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
