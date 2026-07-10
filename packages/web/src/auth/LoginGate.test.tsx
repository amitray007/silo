import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { LoginGate } from './LoginGate';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mirrors App.tsx's AuthGate: LoginGate on 'needs-login', "app content" once past it — so a submitted-valid-password assertion can check the gate is actually replaced, not just that state flipped. */
function Harness() {
  const { state } = useAuth();
  if (state === 'needs-login') return <LoginGate />;
  return <p>App content</p>;
}

function renderHarness() {
  return render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );
}

describe('LoginGate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the password field, label, and submit button once the gate shows', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderHarness();

    const input = await screen.findByLabelText('Password');
    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined();
  });

  it('renders inside a real <form> submitted via the button', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderHarness();

    const input = await screen.findByLabelText('Password');
    expect(input.closest('form')).not.toBeNull();
  });

  it('a correct password POSTs /api/login and replaces the gate with app content', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // POST /api/login
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: true })); // login re-check
    renderHarness();

    const input = await screen.findByLabelText('Password');
    fireEvent.change(input, { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('App content')).toBeDefined());
    expect(screen.queryByLabelText('Password')).toBeNull();

    const loginCall = vi
      .mocked(fetch)
      .mock.calls.find(([input_]) => String(input_).includes('/api/login'));
    expect(loginCall).toBeDefined();
    const [, init] = loginCall ?? [];
    expect((init as RequestInit | undefined)?.method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      password: 'correct-password',
    });
  });

  it('a wrong password shows the inline error and stays on the gate', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
      .mockResolvedValueOnce(
        jsonResponse({ error: 'unauthorized', message: 'Wrong password' }, 401),
      ); // POST /api/login
    renderHarness();

    const input = await screen.findByLabelText('Password');
    fireEvent.change(input, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe("That password didn't work."),
    );
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.queryByText('App content')).toBeNull();
  });

  it('disables the submit button while the login request is pending', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderHarness();

    const input = await screen.findByLabelText('Password');
    fireEvent.change(input, { target: { value: 'some-password' } });

    let resolveLogin!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Checking…' }).hasAttribute('disabled')).toBe(true),
    );

    resolveLogin(jsonResponse({ ok: true }));
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: true }),
    );
    await waitFor(() => expect(screen.getByText('App content')).toBeDefined());
  });

  it('clearing an error by editing the field removes the alert', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
      .mockResolvedValueOnce(
        jsonResponse({ error: 'unauthorized', message: 'Wrong password' }, 401),
      ); // POST /api/login
    renderHarness();

    const input = await screen.findByLabelText('Password');
    fireEvent.change(input, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());

    fireEvent.change(input, { target: { value: 'wrong-password2' } });

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
