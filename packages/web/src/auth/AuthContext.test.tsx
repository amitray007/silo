import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitAuthCleared } from '../api/auth';
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
          <button type="button" onClick={() => login('candidate-password')}>
            submit
          </button>
        </div>
      );
    }

    it('POSTs /api/login with the password, re-checks, and sets "authed" on success', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
        .mockResolvedValueOnce(jsonResponse({ ok: true })) // POST /api/login
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: true })); // re-check after login

      render(
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));

      screen.getByRole('button', { name: 'submit' }).click();

      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('authed'));

      const loginCall = vi
        .mocked(fetch)
        .mock.calls.find(([input]) => String(input).includes('/api/login'));
      expect(loginCall).toBeDefined();
      const [, init] = loginCall ?? [];
      expect((init as RequestInit | undefined)?.method).toBe('POST');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        password: 'candidate-password',
      });
    });

    it('stays on "needs-login" when /api/login rejects the password (401)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
        .mockResolvedValueOnce(
          jsonResponse({ error: 'unauthorized', message: 'Wrong password' }, 401),
        ); // POST /api/login

      render(
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));

      screen.getByRole('button', { name: 'submit' }).click();

      // Only the initial check + the rejected login POST — no re-check fires
      // on a failed login (no cookie was set to confirm).
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('state').textContent).toBe('needs-login');
    });

    it('stays on "needs-login" when the post-login re-check reports unauthenticated', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
        .mockResolvedValueOnce(jsonResponse({ ok: true })) // POST /api/login "succeeds"
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })); // re-check still unauthenticated

      render(
        <AuthProvider>
          <LoginProbe />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));

      screen.getByRole('button', { name: 'submit' }).click();

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
      expect(screen.getByTestId('state').textContent).toBe('needs-login');
    });
  });

  describe('logout', () => {
    function LogoutProbe() {
      const { state, logout } = useAuth();
      return (
        <div>
          <span data-testid="state">{state}</span>
          <button type="button" onClick={() => logout()}>
            log out
          </button>
        </div>
      );
    }

    it('POSTs /api/logout and sets state to "needs-login"', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: true })) // initial check
        .mockResolvedValueOnce(jsonResponse({ ok: true })); // POST /api/logout

      render(
        <AuthProvider>
          <LogoutProbe />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('authed'));

      screen.getByRole('button', { name: 'log out' }).click();

      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));

      const logoutCall = vi
        .mocked(fetch)
        .mock.calls.find(([input]) => String(input).includes('/api/logout'));
      expect(logoutCall).toBeDefined();
      expect((logoutCall?.[1] as RequestInit | undefined)?.method).toBe('POST');
    });

    it('still bounces to "needs-login" even if the logout request itself fails', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: true })) // initial check
        .mockRejectedValueOnce(new TypeError('Failed to fetch')); // POST /api/logout fails

      render(
        <AuthProvider>
          <LogoutProbe />
        </AuthProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('authed'));

      screen.getByRole('button', { name: 'log out' }).click();

      await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('needs-login'));
    });
  });
});
