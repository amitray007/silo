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

/**
 * Stateful fetch stub (mirrors `PluginsTab.test.tsx`'s `mockFetchRouter`) —
 * routes `/api/settings` (GET/PATCH) same as before, plus `/api/access-tokens`
 * (GET list / POST create / DELETE :id). `useCreateAccessToken`/
 * `useRevokeAccessToken`'s `onSuccess` re-invalidates the list, firing a
 * follow-up GET — a stateless mock would hand that GET stale data back,
 * silently reverting whatever the mutation just "persisted."
 */
function mockFetchRouter(opts?: {
  settings?: ReturnType<typeof defaultSettings>;
  tokens?: AccessTokenFixture[];
  createdToken?: string;
  /** `GET /api/config`'s `mcpUrl` — mirrors the API returning it only when
   * `SILO_PUBLIC_MCP_URL` is set server-side. Omitted -> `{}` (the unset shape). */
  configMcpUrl?: string;
}) {
  let settingsStore = opts?.settings ?? defaultSettings();
  let tokensStore = opts?.tokens ?? [];
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

  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.includes('/api/settings')) return handleSettings(method, init);
    if (url.includes('/api/access-tokens')) return handleAccessTokens(url, method, init);
    if (url.includes('/api/config')) return Promise.resolve(jsonResponse(config));
    return Promise.resolve(jsonResponse({}));
  });

  return { fetchMock, getTokens: () => tokensStore };
}

function renderTab(opts?: Parameters<typeof mockFetchRouter>[0]) {
  const { fetchMock, getTokens } = mockFetchRouter(opts);
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AccessTab />
    </QueryClientProvider>,
  );
  return { ...utils, fetchMock, getTokens };
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
      // only `/api/access-tokens` hangs, so `useAccessTokens().isLoading`
      // stays true for the assertion below.
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
    // loading container, carrying the a11y contract.
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeDefined();
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
});
