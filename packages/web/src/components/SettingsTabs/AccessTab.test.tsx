import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessTab } from './AccessTab';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  });
}

/** The default `/api/settings` GET response — mirrors `SETTINGS_DEFAULTS` (`packages/core/src/settings/schema.ts`), `mcpAccess` on by default. */
function defaultSettings() {
  return {
    theme: 'system' as const,
    trashPurgeDays: 30 as const,
    mcpAccess: true,
    linkPreviewImages: true,
    plugins: {
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
      twitter: { enabled: true, inline: true, hover: true },
    },
  };
}

type AccessTokenFixture = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type OAuthClientFixture = {
  clientName: string;
  clientIds: string[];
  grantedAt: string;
  lastUsedAt: string | null;
  activeTokenCount: number;
  connectionCount: number;
};

/**
 * Stateful fetch stub (mirrors `PluginsTab.test.tsx`'s `mockFetchRouter`) —
 * routes `/api/settings` (GET/PATCH), `/api/access-tokens` (GET list / POST
 * create / DELETE :id), and `/api/access-tokens/oauth-clients` (GET list /
 * DELETE :clientId / DELETE collection). `useCreateAccessToken`/
 * `useRevokeAccessToken`/`useRevokeOAuthClient`/`useRevokeAllOAuthClients`'s
 * `onSuccess` re-invalidates their lists, firing a follow-up GET — a
 * stateless mock would hand that GET stale data back, silently reverting
 * whatever the mutation just "persisted."
 *
 * The oauth-clients route is checked BEFORE the plain access-tokens route
 * below (both URLs contain `/api/access-tokens`) — `/api/access-tokens/
 * oauth-clients` must not fall through to `handleAccessTokens`, which would
 * misread it as a `DELETE /api/access-tokens/:id` call.
 */
function mockFetchRouter(opts?: {
  settings?: ReturnType<typeof defaultSettings>;
  tokens?: AccessTokenFixture[];
  createdToken?: string;
  oauthClients?: OAuthClientFixture[];
  /** `GET /api/config`'s `mcpUrl` — mirrors the API returning it only when
   * `SILO_PUBLIC_MCP_URL` is set server-side. Omitted -> `{}` (the unset shape). */
  configMcpUrl?: string;
}) {
  let settingsStore = opts?.settings ?? defaultSettings();
  let tokensStore = opts?.tokens ?? [];
  let oauthClientsStore = opts?.oauthClients ?? [];
  const rawToken = opts?.createdToken ?? 'silo_rawtoken1234567890abcdef';
  const config = opts?.configMcpUrl ? { mcpUrl: opts.configMcpUrl } : {};

  function handleSettings(method: string, init?: RequestInit) {
    if (method === 'PATCH') {
      const patch = JSON.parse((init?.body as string) ?? '{}');
      settingsStore = { ...settingsStore, ...patch };
    }
    return Promise.resolve(jsonResponse(settingsStore));
  }

  function handleAccessTokens(url: string, method: string, init?: RequestInit) {
    if (method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}');
      const created: AccessTokenFixture = {
        id: `new-${tokensStore.length + 1}`,
        name: body.name,
        prefix: rawToken.slice(0, 12),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      tokensStore = [created, ...tokensStore];
      return Promise.resolve(jsonResponse({ ...created, token: rawToken }, 201));
    }
    if (method === 'DELETE') {
      const id = url.split('/api/access-tokens/')[1];
      tokensStore = tokensStore.filter((t) => t.id !== id);
      return Promise.resolve(jsonResponse(undefined, 204));
    }
    return Promise.resolve(jsonResponse({ tokens: tokensStore }));
  }

  function handleOAuthClients(url: string, method: string) {
    if (method === 'DELETE') {
      const clientId = url.split('/api/access-tokens/oauth-clients/')[1];
      if (clientId) {
        // Revoke one client id: drop it from whichever group holds it, and
        // drop the whole group once its last id is gone (mirrors the real
        // "revoke deletes tokens, group disappears from the list" semantics).
        oauthClientsStore = oauthClientsStore
          .map((c) => ({ ...c, clientIds: c.clientIds.filter((id) => id !== clientId) }))
          .filter((c) => c.clientIds.length > 0);
      } else {
        // Collection delete — revoke all.
        oauthClientsStore = [];
      }
      return Promise.resolve(jsonResponse(undefined, 204));
    }
    return Promise.resolve(jsonResponse({ clients: oauthClientsStore }));
  }

  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.includes('/api/settings')) return handleSettings(method, init);
    if (url.includes('/api/access-tokens/oauth-clients')) return handleOAuthClients(url, method);
    if (url.includes('/api/access-tokens')) return handleAccessTokens(url, method, init);
    if (url.includes('/api/config')) return Promise.resolve(jsonResponse(config));
    return Promise.resolve(jsonResponse({}));
  });

  return { fetchMock, getTokens: () => tokensStore, getOAuthClients: () => oauthClientsStore };
}

function renderTab(opts?: Parameters<typeof mockFetchRouter>[0]) {
  const { fetchMock, getTokens, getOAuthClients } = mockFetchRouter(opts);
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AccessTab />
    </QueryClientProvider>,
  );
  return { ...utils, fetchMock, getTokens, getOAuthClients };
}

describe('AccessTab (HTTP MCP + named access tokens)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * The hero's primary action is now "Set up" (formerly "Copy config") — it
   * opens `McpSetupDialog` (a second, stacked `ModalShell`) rather than
   * writing straight to the clipboard. `McpSetupDialog`'s own test file
   * covers the dialog's content and per-field clipboard behavior in detail;
   * this just proves the wiring from the hero button.
   */
  it('"Set up" opens the MCP setup dialog, showing its connection fields', async () => {
    renderTab();

    expect(screen.queryByRole('dialog', { name: 'Connect over MCP' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));

    const dialog = await screen.findByRole('dialog', { name: 'Connect over MCP' });
    expect(dialog).toBeDefined();
    // Spot-check a couple of the dialog's rows render — full field-by-field
    // coverage lives in `McpSetupDialog.test.tsx`.
    expect(screen.getByText('URL')).toBeDefined();
    expect(screen.getByText('Claude Code CLI')).toBeDefined();
  });

  it('closing the setup dialog (Escape) returns to the Settings tab, not past it', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await screen.findByRole('dialog', { name: 'Connect over MCP' });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Connect over MCP' })).toBeNull(),
    );
    // The Access tab underneath (this test's own render) is still there —
    // Escape closed only the dialog, not anything above/around it.
    expect(screen.getByRole('button', { name: 'Set up' })).toBeDefined();
  });

  it('the MCP access row renders as a live switch reflecting mcpAccess from settings', async () => {
    renderTab({ settings: { ...defaultSettings(), mcpAccess: true } });

    const toggle = await screen.findByRole('switch', { name: /MCP access/i });
    await waitFor(() => expect(toggle).toHaveProperty('disabled', false));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('reflects mcpAccess: false from settings as an off switch', async () => {
    renderTab({ settings: { ...defaultSettings(), mcpAccess: false } });

    const toggle = await screen.findByRole('switch', { name: /MCP access/i });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('clicking the MCP access toggle PATCHes mcpAccess flipped', async () => {
    const { fetchMock } = renderTab({ settings: { ...defaultSettings(), mcpAccess: true } });

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

  it('renders the "Access tokens" section heading with its description', async () => {
    renderTab();

    expect(await screen.findByText('Access tokens')).toBeDefined();
    expect(screen.getByText(/Named tokens an agent can use to connect/i)).toBeDefined();
  });

  it('renders the token list from a mocked useAccessTokens (names + prefixes shown)', async () => {
    renderTab({
      tokens: [
        {
          id: 'tok-1',
          name: 'laptop cli',
          prefix: 'silo_a1b2c3',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
        {
          id: 'tok-2',
          name: 'raycast',
          prefix: 'silo_d4e5f6',
          createdAt: '2026-02-01T00:00:00.000Z',
          lastUsedAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    });

    expect(await screen.findByText('laptop cli')).toBeDefined();
    expect(screen.getByText('raycast')).toBeDefined();
    expect(screen.getByText(/silo_a1b2c3/)).toBeDefined();
    expect(screen.getByText(/silo_d4e5f6/)).toBeDefined();
    expect(screen.getByText(/never used/i)).toBeDefined();
    expect(screen.getByText(/last used/i)).toBeDefined();
  });

  it('shows the empty state when there are no tokens', async () => {
    renderTab({ tokens: [] });

    expect(
      await screen.findByText('No tokens yet — create one to let an agent connect.'),
    ).toBeDefined();
  });

  it('shows skeleton rows (not nothing) while the token list is loading', () => {
    const neverResolves = new Promise<Response>(() => {});
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      // Settings resolves normally (unrelated to this list's loading state);
      // `/api/access-tokens` and `/api/access-tokens/oauth-clients` both hang
      // here — this assertion runs synchronously right after `render`,
      // before EITHER list's fetch has had a chance to resolve, so both
      // sections are legitimately still in their initial loading state at
      // this instant (asserted below as "at least one", not "exactly one").
      if (url.includes('/api/settings')) return Promise.resolve(jsonResponse(defaultSettings()));
      if (url.includes('/api/access-tokens')) return neverResolves;
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AccessTab />
      </QueryClientProvider>,
    );

    // Neither the empty state nor any real token row has rendered — only the
    // loading container(s), carrying the a11y contract.
    expect(screen.getAllByRole('status', { name: 'Loading…' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('No tokens yet — create one to let an agent connect.')).toBeNull();
  });

  it('does not show the raw token anywhere in the list rows', async () => {
    renderTab({
      tokens: [
        {
          id: 'tok-1',
          name: 'laptop cli',
          prefix: 'silo_a1b2c3',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
    });

    await screen.findByText('laptop cli');
    expect(screen.queryByText(/silo_rawtoken1234567890abcdef/)).toBeNull();
  });

  it('creating a token calls the mutation with the name, then shows the raw token once + copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const { fetchMock } = renderTab({
      tokens: [],
      createdToken: 'silo_freshraw0987654321zzzz',
    });

    const nameInput = await screen.findByPlaceholderText(/laptop cli, raycast/i);
    fireEvent.change(nameInput, { target: { value: 'my new device' } });

    const createBtn = screen.getByRole('button', { name: 'Create' });
    expect(createBtn).toHaveProperty('disabled', false);
    fireEvent.click(createBtn);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (call) =>
          (call[1] as RequestInit | undefined)?.method === 'POST' &&
          (call[0] as string).includes('/api/access-tokens'),
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
      expect(body).toEqual({ name: 'my new device' });
    });

    // The raw token appears once, in the reveal field — the name input is
    // swapped out for the reveal, so it's no longer on screen.
    expect(await screen.findByText('silo_freshraw0987654321zzzz')).toBeDefined();
    expect(screen.getByText(/copy this now/i)).toBeDefined();
    expect(screen.queryByPlaceholderText(/laptop cli, raycast/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('silo_freshraw0987654321zzzz'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined());

    // Dismiss ("Done") hides the raw token and brings the create form back
    // with the name input cleared (it was consumed by the successful create).
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('silo_freshraw0987654321zzzz')).toBeNull());
    const freshNameInput = await screen.findByPlaceholderText(/laptop cli, raycast/i);
    expect((freshNameInput as HTMLInputElement).value).toBe('');
  });

  it('the Create button is disabled when the name is empty', async () => {
    renderTab({ tokens: [] });

    await screen.findByPlaceholderText(/laptop cli, raycast/i);
    const createBtn = screen.getByRole('button', { name: 'Create' });
    expect(createBtn).toHaveProperty('disabled', true);
  });

  it('revoking a token requires a confirm step, then calls the DELETE mutation and refreshes the list', async () => {
    const { fetchMock } = renderTab({
      tokens: [
        {
          id: 'tok-1',
          name: 'laptop cli',
          prefix: 'silo_a1b2c3',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
    });

    await screen.findByText('laptop cli');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const confirmBtn = await screen.findByRole('button', { name: 'Confirm revoke?' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        (call) =>
          (call[1] as RequestInit | undefined)?.method === 'DELETE' &&
          (call[0] as string).includes('/api/access-tokens/tok-1'),
      );
      expect(deleteCall).toBeDefined();
    });

    await waitFor(() => expect(screen.queryByText('laptop cli')).toBeNull());
  });

  it('canceling the revoke confirm step leaves the token in place', async () => {
    renderTab({
      tokens: [
        {
          id: 'tok-1',
          name: 'laptop cli',
          prefix: 'silo_a1b2c3',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
    });

    await screen.findByText('laptop cli');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await screen.findByRole('button', { name: 'Confirm revoke?' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm revoke?' })).toBeNull(),
    );
    expect(screen.getByText('laptop cli')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDefined();
  });

  describe('Connected apps (MCP OAuth)', () => {
    it('renders the "Connected apps" section heading with its description', async () => {
      renderTab();

      expect(await screen.findByText('Connected apps')).toBeDefined();
      expect(screen.getByText(/Apps that connected over OAuth/i)).toBeDefined();
    });

    it('shows the empty state when no apps are connected', async () => {
      renderTab({ oauthClients: [] });

      expect(await screen.findByText('No apps connected yet.')).toBeDefined();
      // "Revoke all" only makes sense once something is connected.
      expect(screen.queryByRole('button', { name: 'Revoke all' })).toBeNull();
    });

    it('renders a deduped group: name, granted date, last-used, active token count', async () => {
      renderTab({
        oauthClients: [
          {
            clientName: 'Claude',
            clientIds: ['cli-1'],
            grantedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-03-01T00:00:00.000Z',
            activeTokenCount: 1,
            connectionCount: 1,
          },
        ],
      });

      expect(await screen.findByText('Claude')).toBeDefined();
      expect(screen.getByText(/granted/i)).toBeDefined();
      expect(screen.getByText(/last used/i)).toBeDefined();
      expect(screen.getByText(/1 active token/i)).toBeDefined();
      // Single connection — the "(N connections)" note stays quiet.
      expect(screen.queryByText(/connections\)/)).toBeNull();
    });

    it('shows "never used" and the "(N connections)" note when connectionCount > 1', async () => {
      renderTab({
        oauthClients: [
          {
            clientName: 'ChatGPT',
            clientIds: ['cli-1', 'cli-2', 'cli-3'],
            grantedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            activeTokenCount: 2,
            connectionCount: 3,
          },
        ],
      });

      expect(await screen.findByText('ChatGPT')).toBeDefined();
      expect(screen.getByText(/never used/i)).toBeDefined();
      expect(screen.getByText(/\(3 connections\)/)).toBeDefined();
    });

    it('shows skeleton rows while the connected-apps list is loading', () => {
      const neverResolves = new Promise<Response>(() => {});
      // Settings and the plain token list resolve normally (unrelated to
      // this list's loading state); only `/api/access-tokens/oauth-clients`
      // hangs, so `useOAuthClients().isLoading` stays true for the assertion
      // below. A small route table (rather than an if-chain inline in the
      // mock) keeps this test under Biome's cognitive-complexity gate.
      const routes: [match: string, respond: () => Promise<Response>][] = [
        ['/api/access-tokens/oauth-clients', () => neverResolves],
        ['/api/access-tokens', () => Promise.resolve(jsonResponse({ tokens: [] }))],
        ['/api/settings', () => Promise.resolve(jsonResponse(defaultSettings()))],
      ];
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const route = routes.find(([match]) => url.includes(match));
        return route ? route[1]() : Promise.resolve(jsonResponse({}));
      });
      vi.stubGlobal('fetch', fetchMock);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <AccessTab />
        </QueryClientProvider>,
      );

      expect(screen.getAllByRole('status', { name: 'Loading…' }).length).toBeGreaterThan(0);
      expect(screen.queryByText('No apps connected yet.')).toBeNull();
    });

    it('revoking a group requires a confirm step, then DELETEs every id in clientIds (fan-out)', async () => {
      const { fetchMock } = renderTab({
        oauthClients: [
          {
            clientName: 'ChatGPT',
            clientIds: ['cli-1', 'cli-2'],
            grantedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            activeTokenCount: 2,
            connectionCount: 2,
          },
        ],
      });

      await screen.findByText('ChatGPT');

      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
      const confirmBtn = await screen.findByRole('button', { name: 'Confirm revoke?' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        const deleteCalls = fetchMock.mock.calls.filter(
          (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
        );
        const deletedIds = deleteCalls.map(
          (call) => (call[0] as string).split('/api/access-tokens/oauth-clients/')[1],
        );
        expect(deletedIds).toContain('cli-1');
        expect(deletedIds).toContain('cli-2');
      });

      await waitFor(() => expect(screen.queryByText('ChatGPT')).toBeNull());
    });

    it('canceling a group revoke confirm step leaves the group in place', async () => {
      renderTab({
        oauthClients: [
          {
            clientName: 'Claude',
            clientIds: ['cli-1'],
            grantedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            activeTokenCount: 1,
            connectionCount: 1,
          },
        ],
      });

      await screen.findByText('Claude');
      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
      await screen.findByRole('button', { name: 'Confirm revoke?' });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Confirm revoke?' })).toBeNull(),
      );
      expect(screen.getByText('Claude')).toBeDefined();
    });

    it('"Revoke all" requires a confirm step, then DELETEs the collection endpoint', async () => {
      const { fetchMock } = renderTab({
        oauthClients: [
          {
            clientName: 'Claude',
            clientIds: ['cli-1'],
            grantedAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: null,
            activeTokenCount: 1,
            connectionCount: 1,
          },
          {
            clientName: 'ChatGPT',
            clientIds: ['cli-2'],
            grantedAt: '2026-01-02T00:00:00.000Z',
            lastUsedAt: null,
            activeTokenCount: 1,
            connectionCount: 1,
          },
        ],
      });

      await screen.findByText('Claude');

      fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }));
      const confirmBtn = await screen.findByRole('button', { name: 'Confirm revoke all?' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        const deleteCall = fetchMock.mock.calls.find(
          (call) =>
            (call[1] as RequestInit | undefined)?.method === 'DELETE' &&
            (call[0] as string).endsWith('/api/access-tokens/oauth-clients'),
        );
        expect(deleteCall).toBeDefined();
      });

      await waitFor(() => expect(screen.queryByText('Claude')).toBeNull());
      expect(screen.queryByText('ChatGPT')).toBeNull();
    });
  });
});
