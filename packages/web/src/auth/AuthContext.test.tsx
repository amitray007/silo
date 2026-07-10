import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, emitAuthCleared, setToken } from '../api/auth';
import { AuthProvider, useAuth } from './AuthContext';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Renders the auth state + a marker so tests can assert on it via the DOM (mirrors this repo's Testing-Library-only convention — no hook-testing-library). */
function Probe() {
  const { state, checkUnreachable } = useAuth();
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="unreachable">{String(checkUnreachable)}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    sessionStorage.clear();
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    clearToken();
  });

  it('starts in the loading state before the check resolves', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {})); // never resolves
    renderProvider();

    expect(screen.getByTestId('state').textContent).toBe('loading');
  });

  it('does not render the login gate before the check resolves (no flash)', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    renderProvider();

    // Probe itself always renders (it's not conditional on state here), but
    // the state text proves the gate-consuming code (AuthGate in App.tsx)
    // would not yet see 'needs-login' — the loading value is the contract
    // App.tsx renders null against.
    expect(screen.getByTestId('state').textContent).not.toBe('needs-login');
  });

  it('transitions to "open" when authRequired is false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ authRequired: false }));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('open'));
  });

  it('transitions to "authed" when authRequired + authenticated are both true', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: true }),
    );
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('authed'));
  });

  it('transitions to "needs-login" when authRequired is true and authenticated is false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));
    expect(screen.getByTestId('unreachable').textContent).toBe('false');
  });

  it('transitions to "needs-login" with checkUnreachable when the check itself fails to load', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));
    expect(screen.getByTestId('unreachable').textContent).toBe('true');
  });

  it('bounces to "needs-login" when the auth-cleared signal fires mid-session', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: true }),
    );
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('authed'));

    act(() => {
      emitAuthCleared();
    });

    expect(screen.getByTestId('state').textContent).toBe('needs-login');
  });

  it('unsubscribes the auth-cleared listener on unmount', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: true }),
    );
    const { unmount } = renderProvider();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('authed'));

    unmount();

    // Firing the signal after unmount must not throw (no dangling setState
    // on an unmounted component).
    expect(() => emitAuthCleared()).not.toThrow();
  });

  describe('login', () => {
    function LoginProbe() {
      const { state, login } = useAuth();
      return (
        <div>
          <span data-testid="state">{state}</span>
          <button type="button" onClick={() => login('candidate-token')}>
            submit
          </button>
        </div>
      );
    }

    it('sets state to "authed" and returns true when the token validates', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: true })); // re-check after login

      render(
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));

      screen.getByRole('button', { name: 'submit' }).click();

      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('authed'));
    });

    it('stays on "needs-login" and clears the token when it does not validate', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false }))
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false }));

      render(
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));

      setToken('should-be-cleared');
      screen.getByRole('button', { name: 'submit' }).click();

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('state').textContent).toBe('needs-login');
    });
  });
});
