/**
 * The web's auth signal bus (cookie-session model,
 * `docs/superpowers/specs/2026-07-11-web-auth-cookie-upgrade.md`). The web
 * holds no client-side credential anymore: `POST /api/login` (a human
 * password, `AuthContext.login`) sets an HTTP-only, signed `silo_session`
 * cookie server-side, and the browser attaches it automatically on every
 * same-origin request (`apiFetch`'s `credentials: 'include'`, `./client.ts`)
 * — there is nothing here for JS to read, store, or attach as a header.
 *
 * What remains is the `onAuthCleared`/`emitAuthCleared` signal bus: the
 * mechanism `apiFetch` uses to tell `AuthContext` "a request just came back
 * 401, bounce to the login gate" without the api layer importing React.
 * Deliberately framework-free (a plain listener `Set`, not a React
 * context/event emitter) since this is the api layer, not UI — `web` cannot
 * import `@silo/core`, and this module in turn must stay dependency-free of
 * React so it's usable from any layer above it.
 */

/**
 * Every subscriber registered via `onAuthCleared`. A `Set` (not an array) so
 * unsubscribe is an O(1) delete rather than a splice/filter.
 */
const authClearedListeners = new Set<() => void>();

/**
 * Subscribes to "a request just came back 401" — the signal `AuthContext`
 * listens on to bounce a mid-session user back to the login gate (the
 * session cookie was rejected or expired server-side; there is no local
 * token to drop, only the UI state to reset). Returns an unsubscribe
 * function.
 */
export function onAuthCleared(cb: () => void): () => void {
  authClearedListeners.add(cb);
  return () => {
    authClearedListeners.delete(cb);
  };
}

/**
 * Fires every `onAuthCleared` subscriber. Called by `apiFetch`'s 401 path
 * (`./client.ts`) — the one place a stale/rejected session is discovered
 * mid-session.
 */
export function emitAuthCleared(): void {
  for (const cb of authClearedListeners) {
    cb();
  }
}
