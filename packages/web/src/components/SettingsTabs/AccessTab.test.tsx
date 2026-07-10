import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../../api/auth';
import { AccessTab } from './AccessTab';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The default `/api/settings` GET response — mirrors `SETTINGS_DEFAULTS` (`packages/core/src/settings/schema.ts`), `mcpAccess` on by default. */
function defaultSettings() {
  return {
    theme: 'system' as const,
    trashPurgeDays: 30 as const,
    mcpAccess: true,
    plugins: {
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
      twitter: { enabled: true, inline: true, hover: true },
    },
  };
}

/**
 * Stateful fetch stub (mirrors `PluginsTab.test.tsx`'s `mockFetchRouter`) —
 * `useUpdateSettings`'s `onSettled` re-invalidates `settings` after every
 * PATCH, firing a follow-up GET; a stateless mock would hand that GET the
 * original defaults back, silently reverting whatever the PATCH just
 * "persisted."
 */
function mockFetchRouter(initial = defaultSettings()) {
  let store = initial;
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/settings')) {
      if (init?.method === 'PATCH') {
        const patch = JSON.parse((init.body as string) ?? '{}');
        store = { ...store, ...patch };
        return Promise.resolve(jsonResponse(store));
      }
      return Promise.resolve(jsonResponse(store));
    }
    return Promise.resolve(jsonResponse({}));
  });
  return { fetchMock, getStore: () => store };
}

function renderTab(initial?: ReturnType<typeof defaultSettings>) {
  const { fetchMock, getStore } = mockFetchRouter(initial);
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AccessTab />
    </QueryClientProvider>,
  );
  return { ...utils, fetchMock, getStore };
}

describe('AccessTab (HTTP MCP + API key)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('"Copy config" writes the HTTP+bearer MCP config to the clipboard', async () => {
    vi.spyOn(auth, 'getToken').mockReturnValue(null);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string;

    // The HTTP+bearer shape.
    expect(copied).toContain('/mcp');
    expect(copied).toContain('Authorization');
    expect(copied).toContain('Bearer');
    expect(copied).toContain('<YOUR_SILO_API_TOKEN>');

    // Never the old stdio subprocess config.
    expect(copied).not.toContain('"command"');
    expect(copied).not.toContain('"args"');
    expect(copied).not.toContain('pnpm');

    // Never a real token value.
    expect(copied).not.toMatch(/Bearer (?!<YOUR_SILO_API_TOKEN>)\S+/);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined());
  });

  it('flashes "Couldn\'t copy" when the clipboard write fails, and resets after', async () => {
    vi.spyOn(auth, 'getToken').mockReturnValue(null);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: "Couldn't copy" })).toBeDefined(),
    );

    vi.advanceTimersByTime(1500);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy config' })).toBeDefined());

    vi.useRealTimers();
  });

  it('the access token row explains the session-token model and shows no real token on screen', () => {
    vi.spyOn(auth, 'getToken').mockReturnValue(null);
    renderTab();

    expect(screen.getByText('Access token')).toBeDefined();
    expect(screen.getByText(/Your session token/i)).toBeDefined();

    // The old "Rotate"/"Env-set" affordances are gone.
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Env-set' })).toBeNull();
  });

  it('the MCP access row renders as a live switch reflecting mcpAccess from settings', async () => {
    renderTab({ ...defaultSettings(), mcpAccess: true });

    const toggle = await screen.findByRole('switch', { name: /MCP access/i });
    await waitFor(() => expect(toggle).toHaveProperty('disabled', false));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('reflects mcpAccess: false from settings as an off switch', async () => {
    renderTab({ ...defaultSettings(), mcpAccess: false });

    const toggle = await screen.findByRole('switch', { name: /MCP access/i });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('clicking the MCP access toggle PATCHes mcpAccess flipped', async () => {
    const { fetchMock } = renderTab({ ...defaultSettings(), mcpAccess: true });

    const toggle = await screen.findByRole('switch', { name: /MCP access/i });
    await waitFor(() => expect(toggle).toHaveProperty('disabled', false));
    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body).toEqual({ mcpAccess: false });
    });

    // Optimistic update flips the switch immediately.
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('the MCP access toggle is disabled while settings are still loading', () => {
    const neverResolves = new Promise<Response>(() => {});
    const fetchMock = vi.fn().mockReturnValue(neverResolves);
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AccessTab />
      </QueryClientProvider>,
    );

    const toggle = screen.getByRole('switch', { name: /MCP access/i });
    expect(toggle).toHaveProperty('disabled', true);
  });

  it('"Copy token" copies the logged-in token to the clipboard when one is held', async () => {
    vi.spyOn(auth, 'getToken').mockReturnValue('secret-token-value');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    renderTab();
    const button = screen.getByRole('button', { name: 'Copy token' });
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('secret-token-value'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined());
  });

  it('"Copy token" is disabled with honest copy when no token is held (localhost no-auth mode)', () => {
    vi.spyOn(auth, 'getToken').mockReturnValue(null);
    renderTab();

    const button = screen.getByRole('button', { name: 'Copy token' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('title')).toMatch(/no token in this session/i);
  });
});
