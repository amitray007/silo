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

/** Mirrors App.tsx's AuthGate: LoginGate on 'needs-login', "app content" once past it — so a submitted-valid-token assertion can check the gate is actually replaced, not just that state flipped. */
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
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('renders the password field, label, and submit button once the gate shows', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderHarness();

    const input = await screen.findByLabelText('Access token');
    expect(input.getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDefined();
  });

  it('renders inside a real <form> submitted via the button', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderHarness();

    const input = await screen.findByLabelText('Access token');
    expect(input.closest('form')).not.toBeNull();
  });

  it('a valid token replaces the gate with app content', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false })) // initial check
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: true })); // login re-check
    renderHarness();

    const input = await screen.findByLabelText('Access token');
    fireEvent.change(input, { target: { value: 'correct-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('App content')).toBeDefined());
    expect(screen.queryByLabelText('Access token')).toBeNull();
  });

  it('a wrong token shows the inline error and stays on the gate', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false }))
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false }));
    renderHarness();

    const input = await screen.findByLabelText('Access token');
    fireEvent.change(input, { target: { value: 'wrong-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe("That token didn't work."),
    );
    expect(screen.getByLabelText('Access token')).toBeDefined();
    expect(screen.queryByText('App content')).toBeNull();
  });

  it('disables the submit button while the login request is pending', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderHarness();

    const input = await screen.findByLabelText('Access token');
    fireEvent.change(input, { target: { value: 'some-token' } });

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

    resolveLogin(jsonResponse({ authRequired: true, authenticated: true }));
    await waitFor(() => expect(screen.getByText('App content')).toBeDefined());
  });

  it('clearing an error by editing the field removes the alert', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false }))
      .mockResolvedValueOnce(jsonResponse({ authRequired: true, authenticated: false }));
    renderHarness();

    const input = await screen.findByLabelText('Access token');
    fireEvent.change(input, { target: { value: 'wrong-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());

    fireEvent.change(input, { target: { value: 'wrong-token2' } });

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
