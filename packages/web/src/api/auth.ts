/**
 * The client-side "password" for a deployment that sets `SILO_API_TOKEN`
 * (`docs/superpowers/specs/2026-07-10-web-auth-design.md`). There is no
 * separate credential store: the token entered on the login gate IS
 * `SILO_API_TOKEN`, held here for the tab's lifetime and attached as a
 * bearer by `apiFetch` (`./client.ts`) on every `/api/*` call.
 *
 * Storage is `sessionStorage` (survives reloads within the tab, not
 * indefinitely — re-login on a fresh session) with an in-memory cache in
 * front of it, so a read never has to touch storage twice and a
 * storage-unavailable environment (private browsing, SSR, a disabled-storage
 * policy) degrades to memory-only rather than throwing.
 */

const STORAGE_KEY = 'silo.apiToken';

/**
 * `undefined` = "not yet read from sessionStorage this page load" (so
 * `getToken` knows to attempt one read-through); `null` = "known absent."
 * Distinguishing the two avoids re-hitting sessionStorage on every call once
 * we've established there's nothing there.
 */
let memoryToken: string | null | undefined;

/**
 * Every subscriber registered via `onAuthCleared`. A `Set` (not an array) so
 * unsubscribe is an O(1) delete rather than a splice/filter.
 */
const authClearedListeners = new Set<() => void>();

/**
 * Returns the current token, preferring the in-memory cache and falling back
 * to a guarded `sessionStorage` read on first access. `null` means "no
 * token" (auth not in use, or not yet logged in) — never throws.
 */
export function getToken(): string | null {
  if (memoryToken !== undefined) {
    return memoryToken;
  }

  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (private mode / SSR / disabled storage) —
    // fall back to memory-only for the rest of this page load.
  }

  memoryToken = stored;
  return memoryToken;
}

/**
 * Stores `token` for the rest of the tab session: memory immediately (so
 * `getToken` reflects it even if the storage write below fails), and
 * `sessionStorage` best-effort so a reload within the tab keeps it.
 */
export function setToken(token: string): void {
  memoryToken = token;
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage unavailable — memory-only for this page load is still correct.
  }
}

/**
 * Clears the token from memory and `sessionStorage`. Called both from an
 * explicit logout path (none yet — parked, see the design spec) and from
 * `apiFetch`'s 401 handling, where a stale/invalid token must be dropped so
 * the app doesn't keep resending it.
 */
export function clearToken(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — memory is already cleared, which is what matters.
  }
}

/**
 * Subscribes to "the token was just cleared because a request came back
 * 401" — the signal `AuthContext` (Unit 3) listens on to bounce a
 * mid-session user back to the login gate. Returns an unsubscribe function.
 * Deliberately framework-free (a plain listener `Set`, not a React
 * context/event emitter) since this is the api layer, not UI — `web` cannot
 * import `@silo/core`, and this module in turn must stay dependency-free of
 * React so it's usable from any layer above it.
 */
export function onAuthCleared(cb: () => void): () => void {
  authClearedListeners.add(cb);
  return () => {
    authClearedListeners.delete(cb);
  };
}

/**
 * Fires every `onAuthCleared` subscriber. Internal — only `clearToken`'s
 * caller in `apiFetch`'s 401 path calls this (not `clearToken` itself,
 * since not every `clearToken` call is a 401: `AuthContext.login` also
 * clears on a rejected token, where re-showing the same gate is already the
 * behavior and no extra signal is needed).
 */
export function emitAuthCleared(): void {
  for (const cb of authClearedListeners) {
    cb();
  }
}
