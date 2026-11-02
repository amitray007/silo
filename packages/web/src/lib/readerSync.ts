import { isRecord } from './prefStore';

/** Syncs optimistic local reader choices with ordered, full-snapshot server writes. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type SyncTransport<T extends object> = {
  /** Sends the complete scope with a monotonically increasing client timestamp. */
  send(value: T, writtenAt: string): Promise<T>;
  /** Best effort while the page is closing: must survive the page. */
  keepalive(value: T, writtenAt: string): void;
};

type Plain = Record<string, unknown>;

/** Lays `patch` over `base` one level at a time, so an untouched field keeps its value. */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return (patch === undefined ? base : patch) as T;
  const merged: Plain = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = key in base ? mergeDeep(base[key], value) : value;
  }
  return merged as T;
}

/** Restore failed leaves, including removing a newly added override, without undoing later edits. */
function rollback(current: unknown, confirmed: unknown, changes: unknown): unknown {
  if (!isRecord(changes)) return Object.is(current, changes) ? confirmed : current;
  const out: Plain = isRecord(current) ? { ...current } : {};
  const back = isRecord(confirmed) ? confirmed : {};
  for (const [key, value] of Object.entries(changes)) {
    const reverted = rollback(out[key], back[key], value);
    if (reverted === undefined) delete out[key];
    else if (isRecord(reverted) && !Object.keys(reverted).length && !(key in back)) delete out[key];
    else out[key] = reverted;
  }
  return out;
}

export function createSync<T extends object>(deps: {
  read: () => T;
  /**
   * Writes a partial value into the local copy (and its mirror). `force` writes even when the
   * value looks unchanged, so a change the user makes also repairs a mirror that failed to save.
   */
  apply: (patch: DeepPartial<T>, force: boolean) => void;
  /** Replace the local value, including deleting absent override fields. */
  replace?: (value: T) => void;
  /** True when this browser holds values of its own worth uploading. */
  hasLocal: () => boolean;
}) {
  const replace = deps.replace ?? ((value: T) => deps.apply(value as DeepPartial<T>, false));
  let transport: SyncTransport<T> | null = null;
  let pending: DeepPartial<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight = false;
  let uploaded = false;
  let serverValue: T | null | undefined;
  let confirmed = deps.read();
  let generation = 0;
  let lastWrittenAt = 0;
  const writtenAt = () => {
    lastWrittenAt = Math.max(Date.now(), lastWrittenAt + 1);
    return new Date(lastWrittenAt).toISOString();
  };
  let detachWhenIdle: (() => void) | undefined;
  const settled = () => {
    if (!inflight && !pending) {
      detachWhenIdle?.();
      detachWhenIdle = undefined;
    }
  };

  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!transport || inflight || serverValue === undefined) return;
    if (!pending && !(serverValue === null && !uploaded && deps.hasLocal())) return;
    const changes = pending;
    // A newer snapshot includes every earlier field, even if that earlier request is rejected.
    const value = deps.read();
    const run = generation;
    pending = null;
    inflight = true;
    transport.send(value, writtenAt()).then(
      (server) => {
        if (run !== generation) return;
        inflight = false;
        uploaded = true;
        serverValue = server;
        confirmed = server;
        replace(mergeDeep(server, pending ?? {}));
        if (pending && timer === undefined) flush();
        settled();
      },
      () => {
        if (run !== generation) return;
        inflight = false;
        if (changes) {
          replace(rollback(deps.read(), confirmed, changes) as T);
          // An equal-valued queued edit still belongs to the next request.
          if (pending) deps.apply(pending, false);
        }
        if (pending && timer === undefined) flush();
        settled();
      },
    );
  };

  const onHide = () => {
    if (!transport || !pending) return;
    transport.keepalive(deps.read(), writtenAt());
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') onHide();
  };

  return {
    /** Applies `patch` here now and queues it for the server, after `delayMs` (0 = now). */
    commit(patch: DeepPartial<T>, delayMs = 0): void {
      pending = mergeDeep(pending ?? ({} as DeepPartial<T>), patch);
      deps.apply(patch, true);
      clearTimeout(timer);
      timer = undefined;
      if (delayMs > 0) timer = setTimeout(flush, delayMs);
      else flush();
    },
    /** The server value arrived (or changed). Null means it has none: upload ours, once. */
    hydrate(server: T | null): void {
      if (inflight || (pending && serverValue !== undefined)) return;
      // A stale null refetch must not undo a successful upload.
      if (server === null && uploaded) return;
      serverValue = server;
      if (server !== null) {
        confirmed = server;
        replace(mergeDeep(server, pending ?? {}));
      }
      if (timer === undefined) flush();
    },
    connect(next: SyncTransport<T>, drain = false, onDetached = () => {}): () => void {
      detachWhenIdle = undefined;
      transport = next;
      addEventListener('pagehide', onHide);
      document.addEventListener('visibilitychange', onVisibilityChange);
      flush();
      const detach = () => {
        if (transport !== next) return;
        removeEventListener('pagehide', onHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        transport = null;
        onDetached();
      };
      return () => {
        if (transport !== next) return;
        if (!drain) return detach();
        detachWhenIdle = detach;
        flush();
        settled();
      };
    },
    /** Test hook: discard queued work and ignore replies from an earlier test. */
    reset(): void {
      generation += 1;
      clearTimeout(timer);
      timer = undefined;
      pending = null;
      inflight = false;
      uploaded = false;
      serverValue = undefined;
      confirmed = deps.read();
    },
  };
}
