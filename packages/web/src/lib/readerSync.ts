/**
 * Keeps a browser-local preference object in step with a server copy, without owning either.
 * The local copy is what the UI reads, so every change shows at once. A change is also queued
 * for the server as a partial value (so two browsers changing different fields do not undo each
 * other), sent at once or after a short pause for steppers, one request at a time. If the server
 * refuses a change, the fields it touched go back to what they were. When the server answers
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

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lays `patch` over `base` one level at a time, so an untouched field keeps its value. */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const merged: Plain = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = key in base ? mergeDeep(base[key], value) : value;
  }
  return merged as T;
}

/** The part of `source` that `shape` names: the same keys, `source`'s values. */
function pick(source: unknown, shape: unknown): unknown {
  if (!isPlain(shape)) return source;
  const out: Plain = {};
  const from = isPlain(source) ? source : {};
  for (const key of Object.keys(shape)) out[key] = pick(from[key], shape[key]);
  return out;
}

/** The leaves of `undo` whose field still holds the value `sent` put there. */
function revertable(undo: unknown, sent: unknown, current: unknown): unknown {
  if (!isPlain(undo) || !isPlain(sent)) return Object.is(sent, current) ? undo : undefined;
  const out: Plain = {};
  const now = isPlain(current) ? current : {};
  for (const key of Object.keys(undo)) {
    const value = revertable(undo[key], sent[key], now[key]);
    if (value !== undefined) out[key] = value;
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
  /** True when this browser holds values of its own worth uploading. */
  hasLocal: () => boolean;
}) {
  let transport: SyncTransport<T> | null = null;
  let pending: DeepPartial<T> | null = null;
  let undo: DeepPartial<T> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight = false;
  let uploaded = false;

  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!transport || inflight || !pending) return;
    const patch = pending;
    const back = undo;
    pending = null;
    undo = null;
    inflight = true;
    transport.send(patch).then(
      (server) => {
        inflight = false;
        if (!pending) deps.apply(server as DeepPartial<T>, false);
        else if (timer === undefined) flush();
      },
      () => {
        inflight = false;
        if (back) deps.apply(revertable(back, patch, deps.read()) as DeepPartial<T>, false);
        if (pending && timer === undefined) flush();
      },
    );
  };

  const onHide = () => {
    if (transport && pending) transport.keepalive(pending);
  };

  return {
    /** Applies `patch` here now and queues it for the server, after `delayMs` (0 = now). */
    commit(patch: DeepPartial<T>, delayMs = 0): void {
      // The first value of a field since the last send is the one a refusal restores.
      undo = mergeDeep(pick(deps.read(), patch) as DeepPartial<T>, undo ?? {});
      pending = mergeDeep(pending ?? ({} as DeepPartial<T>), patch);
      deps.apply(patch, true);
      clearTimeout(timer);
      timer = undefined;
      if (delayMs > 0) timer = setTimeout(flush, delayMs);
      else flush();
    },
    /** The server value arrived (or changed). Null means it has none: upload ours, once. */
    hydrate(server: T | null): void {
      if (inflight || pending) return;
      if (server !== null) {
        deps.apply(server as DeepPartial<T>, false);
      } else if (!uploaded && deps.hasLocal()) {
        uploaded = true;
        pending = deps.read() as DeepPartial<T>;
        undo = null;
        flush();
      }
    },
    connect(next: SyncTransport<T>): () => void {
      transport = next;
      addEventListener('pagehide', onHide);
      flush();
      return () => {
        removeEventListener('pagehide', onHide);
        if (transport === next) transport = null;
      };
    },
    busy: () => inflight || pending !== null,
  };
}
