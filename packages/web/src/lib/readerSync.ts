import { isRecord } from './prefStore';

/**
 * Keeps a browser-local preference object in step with a server copy, without owning either.
 * The local copy is what the UI reads, so every change shows at once. A change is also queued
 * for the server as a partial value (so two browsers changing different fields do not undo each
 * other), sent at once or after a short pause for steppers, one request at a time. If the server
 * refuses a change, the fields it touched go back to the last confirmed value. When the server answers
 * with its own copy and nothing is waiting to be sent, the server copy wins.
 */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type SyncTransport<T extends object> = {
  /** Sends a partial value; resolves with the server's whole value. */
  send(patch: DeepPartial<T>): Promise<T>;
  /** Best effort while the page is closing: must survive the page. */
  keepalive(patch: DeepPartial<T>): void;
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
    // Until migration succeeds, every send includes the whole local value, even after a failure.
    const patch = serverValue === null ? mergeDeep(deps.read(), changes ?? {}) : changes;
    if (!patch) return;
    const run = generation;
    pending = null;
    inflight = true;
    transport.send(patch).then(
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
    const patch =
      serverValue === null || serverValue === undefined ? mergeDeep(deps.read(), pending) : pending;
    transport.keepalive(patch);
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
    connect(next: SyncTransport<T>, drain = false): () => void {
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
      };
      return () => {
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
