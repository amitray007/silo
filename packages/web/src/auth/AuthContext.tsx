import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { clearToken, onAuthCleared, setToken } from '../api/auth';
import { apiGet } from '../api/client';

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
 * The app's auth state machine (plan 030 Unit 3;
 * `docs/superpowers/specs/2026-07-10-web-auth-design.md`):
 *
 * - `'loading'` — the initial `/api/auth/check` hasn't resolved yet. The app
 *   renders nothing (not the gate, not the routes) so a fast "no auth needed"
 *   deployment never flashes a login card it doesn't need.
 * - `'open'` — `SILO_API_TOKEN` is unset on the server; this deployment has
 *   no login. Renders the app, forever, for this session.
 * - `'authed'` — a token is required AND the one this tab is holding (if any)
 *   validated. Renders the app.
 * - `'needs-login'` — a token is required and none is held, the held one is
 *   invalid, a 401 anywhere just cleared it, OR the check itself couldn't be
 *   reached at all (see `checkAuth`'s catch below). Renders `LoginGate`.
 */
export type AuthState = 'loading' | 'open' | 'authed' | 'needs-login';

interface AuthContextValue {
  state: AuthState;
  /** True only for the specific case where the initial check failed to reach the server at all (distinct from "reached it and got a 401/invalid token"), so `LoginGate` can show a "couldn't reach the server" note instead of the generic "token didn't work" copy. */
  checkUnreachable: boolean;
  /**
   * Submits `token` as the candidate `SILO_API_TOKEN`: stores it, re-runs
   * the check with it attached, and resolves to whether it validated. On
   * `false` the token is dropped again (`clearToken`) so a rejected guess
   * never lingers as the "current" token — the gate stays up either way,
   * `login`'s return value is what tells the caller which happened.
   */
  login: (token: string) => Promise<boolean>;
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
        // apiGet (not a bare fetch) so a token already sitting in
        // sessionStorage from an earlier session is attached as the bearer —
        // that's what lets a returning user with a still-valid token land
        // straight on 'authed' instead of the gate.
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
        // A 401 anywhere (apiFetch, api/client.ts) already cleared the token
        // — bounce a mid-session user back to the gate.
        setCheckUnreachable(false);
        setState('needs-login');
      }),
    [],
  );

  const login = useCallback(async (token: string): Promise<boolean> => {
    setToken(token);
    try {
      const response = await apiGet<AuthCheckResponse>('/api/auth/check');
      if (response.authRequired && response.authenticated) {
        setCheckUnreachable(false);
        setState('authed');
        return true;
      }
      clearToken();
      return false;
    } catch {
      // The re-check itself failed to reach the server — the candidate token
      // was neither confirmed nor refuted, so treat it the same as a wrong
      // token: drop it and stay on the gate rather than guessing "authed".
      clearToken();
      return false;
    }
  }, []);

  return (
    <AuthContext.Provider value={{ state, checkUnreachable, login }}>
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
