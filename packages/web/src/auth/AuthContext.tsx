import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthCleared } from '../api/auth';
import { apiGet, apiPost } from '../api/client';

/**
 * Hand-typed mirror of `@silo/api`'s `GET /api/auth/check` response
 * (`packages/api/src/routes/auth.ts`). Web cannot import `@silo/core`/
 * `@silo/api` (the bundling rule — `docs/rules/web-react.md`), so this shape
 * is copied here rather than imported, same as every other wire type in
 * `src/api/types.ts`.
 */
interface AuthCheckResponse {
  authRequired: boolean;
  authenticated?: boolean;
}

/**
 * The app's auth state machine (cookie-session model,
 * `docs/superpowers/specs/2026-07-11-web-auth-cookie-upgrade.md`, superseding
 * plan 030's bearer-token version):
 *
 * - `'loading'` — the initial `/api/auth/check` hasn't resolved yet. The app
 *   renders nothing (not the gate, not the routes) so a fast "no auth needed"
 *   deployment never flashes a login card it doesn't need.
 * - `'open'` — neither `SILO_APP_PASSWORD` nor `SILO_API_TOKEN` is set on the
 *   server; this deployment has no login. Renders the app, forever, for this
 *   session.
 * - `'authed'` — auth is required AND this browser holds a valid
 *   `silo_session` cookie (or, for a non-browser caller, a valid Bearer —
 *   irrelevant here since the web never holds one). Renders the app.
 * - `'needs-login'` — auth is required and no valid session cookie is
 *   present, a 401 anywhere just signaled the cookie was rejected, OR the
 *   check itself couldn't be reached at all (see `checkAuth`'s catch below).
 *   Renders `LoginGate`.
 */
export type AuthState = 'loading' | 'open' | 'authed' | 'needs-login';

interface AuthContextValue {
  state: AuthState;
  /** True only for the specific case where the initial check failed to reach the server at all (distinct from "reached it and got a 401/invalid session"), so `LoginGate` can show a "couldn't reach the server" note instead of the generic "wrong password" copy. */
  checkUnreachable: boolean;
  /**
   * Submits `password` to `POST /api/login`. On success the server sets the
   * `silo_session` cookie, so the check is re-run (now cookie-bearing) to
   * confirm it landed and flip state to `'authed'`. On a wrong password
   * (`/api/login` responds 401) resolves to `false` and the gate stays up —
   * there is no local credential to clean up either way, since the web never
   * held one to begin with.
   */
  login: (password: string) => Promise<boolean>;
  /**
   * Submits `POST /api/logout` (clears the `silo_session` cookie
   * server-side, always 200) and drops straight to `'needs-login'` — the
   * sidebar's Log out button (Unit 6) is the only caller. No local state to
   * clear beyond the auth state itself.
   */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function classify(response: AuthCheckResponse): AuthState {
  if (!response.authRequired) return 'open';
  return response.authenticated ? 'authed' : 'needs-login';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [checkUnreachable, setCheckUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        // apiGet (not a bare fetch) so credentials:'include' is set and any
        // silo_session cookie already sitting in the browser from an
        // earlier login is sent along — that's what lets a returning user
        // with a still-valid session land straight on 'authed' instead of
        // the gate.
        const response = await apiGet<AuthCheckResponse>('/api/auth/check');
        if (cancelled) return;
        setCheckUnreachable(false);
        setState(classify(response));
      } catch {
        if (cancelled) return;
        // The check itself failed to load (network down, API unreachable,
        // dev proxy target not running, ...) — NOT the same as "reached the
        // server and it said unauthenticated". We deliberately do not fall
        // through to 'open': silently rendering the app when we have no idea
        // whether this deployment requires a token would defeat the whole
        // point of the gate on any transient network hiccup. Safe default is
        // to show the login gate with a distinguishable note rather than a
        // blank/broken app, and a token already held locally is untrusted
        // until the check confirms it, so it does not get a free pass either.
        setCheckUnreachable(true);
        setState('needs-login');
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onAuthCleared(() => {
        // A 401 anywhere (apiFetch, api/client.ts) means the session cookie
        // was rejected or expired server-side — bounce a mid-session user
        // back to the gate.
        setCheckUnreachable(false);
        setState('needs-login');
      }),
    [],
  );

  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      await apiPost('/api/login', { password });
    } catch {
      // A wrong password is a 401 ApiError from apiPost — the gate stays up,
      // no cookie was set. Any other failure (network down, unreachable
      // server) is treated the same way: neither confirmed nor refuted, so
      // stay on the gate rather than guessing "authed".
      return false;
    }

    // The server just set the silo_session cookie — re-run the check
    // (now cookie-bearing) to confirm it actually landed before flipping to
    // 'authed'. This mirrors the mount-time check's own honesty: we don't
    // assume success from a 200 alone.
    try {
      const response = await apiGet<AuthCheckResponse>('/api/auth/check');
      if (response.authRequired && response.authenticated) {
        setCheckUnreachable(false);
        setState('authed');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    // Always 200 server-side (docs/superpowers/specs/2026-07-11-web-auth-cookie-upgrade.md)
    // — logout is a best-effort cookie clear either way, so a failed request
    // (network down, server unreachable) is swallowed rather than left as an
    // unhandled rejection: the sidebar's Log out button (Unit 6) fires this
    // as `onClick={() => logout()}`, with nothing awaiting the result. The
    // UI still bounces to the gate regardless, rather than leaving a stale
    // 'authed' state the user can't get out of.
    try {
      await apiPost('/api/logout', undefined);
    } catch {
      // Best-effort — the UI transition below happens either way.
    } finally {
      setCheckUnreachable(false);
      setState('needs-login');
    }
  }, []);

  return (
    <AuthContext.Provider value={{ state, checkUnreachable, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
