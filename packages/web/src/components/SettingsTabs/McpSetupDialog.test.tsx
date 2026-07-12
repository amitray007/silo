import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpSetupDialog } from './McpSetupDialog';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stubs `fetch` for just `/api/config` (the only endpoint `McpSetupDialog` reads, via `useAppConfig`) — mirrors `AccessTab.test.tsx`'s router, scoped down since this dialog has no other data needs. */
function stubConfig(configMcpUrl?: string) {
  const config = configMcpUrl ? { mcpUrl: configMcpUrl } : {};
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/config')) return Promise.resolve(jsonResponse(config));
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderDialog(onClose = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <McpSetupDialog onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('McpSetupDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the URL, transport, auth header, CLI, and JSON config fields', async () => {
    stubConfig();
    renderDialog();

    // jsdom's default `window.location.hostname` is `localhost`, so
    // `resolveMcpUrl` falls back to the dev-default — same precedence
    // `lib/mcpUrl.test.ts` covers directly.
    await screen.findByText('http://127.0.0.1:8788/mcp');

    expect(screen.getByText('URL')).toBeDefined();
    expect(screen.getByText('Transport')).toBeDefined();
    expect(screen.getByText('Streamable HTTP')).toBeDefined();
    expect(screen.getByText('Auth header')).toBeDefined();
    expect(screen.getByText('Authorization: Bearer <YOUR_SILO_API_TOKEN>')).toBeDefined();
    expect(screen.getByText('Claude Code CLI')).toBeDefined();
    expect(
      screen.getByText(
        'claude mcp add --transport http silo http://127.0.0.1:8788/mcp --header "Authorization: Bearer <YOUR_SILO_API_TOKEN>"',
      ),
    ).toBeDefined();
    expect(screen.getByText('JSON config')).toBeDefined();
  });

  it('the auth header and JSON config both carry the literal placeholder, never a real token', async () => {
    stubConfig();
    renderDialog();

    await screen.findByText('http://127.0.0.1:8788/mcp');

    const authHeader = screen.getByText('Authorization: Bearer <YOUR_SILO_API_TOKEN>');
    expect(authHeader.textContent).toContain('<YOUR_SILO_API_TOKEN>');
    expect(authHeader.textContent).not.toMatch(/Bearer (?!<YOUR_SILO_API_TOKEN>)\S+/);

    const jsonConfig = screen.getByText(
      (_, element) => element?.tagName === 'CODE' && element.textContent?.includes('"mcpServers"'),
    );
    expect(jsonConfig.textContent).toContain('<YOUR_SILO_API_TOKEN>');
    expect(jsonConfig.textContent).not.toContain('"command"');
    expect(jsonConfig.textContent).not.toContain('"args"');
  });

  it('resolves the URL from an operator-set SILO_PUBLIC_MCP_URL (via GET /api/config)', async () => {
    stubConfig('https://mcp.override.example/mcp');
    renderDialog();

    await screen.findByText('https://mcp.override.example/mcp');
    expect(
      screen.getByText(
        'claude mcp add --transport http silo https://mcp.override.example/mcp --header "Authorization: Bearer <YOUR_SILO_API_TOKEN>"',
      ),
    ).toBeDefined();
  });

  it('a non-localhost origin with no config override shows the "not configured" notice (no URL guessing)', async () => {
    stubConfig();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, hostname: 'silo.example.com', protocol: 'https:' },
    });

    try {
      renderDialog();
      // No guessed https://mcp.silo.example.com/mcp — instead a prompt to set
      // SILO_PUBLIC_MCP_URL, since the MCP host can't be inferred.
      await screen.findByText('MCP URL not configured');
      expect(screen.getByText('SILO_PUBLIC_MCP_URL')).toBeDefined();
      expect(screen.queryByText('https://mcp.silo.example.com/mcp')).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('each copy button copies its own field value, independently of the others', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubConfig();
    renderDialog();

    await screen.findByText('http://127.0.0.1:8788/mcp');

    const copyButtons = screen.getAllByRole('button', { name: 'Copy' });
    // URL, auth header, CLI, JSON config — Transport has no copy button (a
    // fixed word, per the brief).
    expect(copyButtons).toHaveLength(4);
    const [urlBtn, authBtn, cliBtn, jsonBtn] = copyButtons;

    // URL row.
    fireEvent.click(urlBtn as HTMLElement);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('http://127.0.0.1:8788/mcp'));

    // Copying the URL row's value flashes ONLY that row's button — the other
    // three copy buttons (each its own `useCopyFlash()` instance) still show
    // their idle "Copy" label rather than "Copied", proving independence.
    // Checked BEFORE clicking the rest, since every button's flash is the
    // same 1500ms-visible "Copied" (they don't race each other back to idle
    // within this test).
    await waitFor(() => expect(urlBtn?.textContent).toBe('Copied'));
    expect(authBtn?.textContent).toBe('Copy');
    expect(cliBtn?.textContent).toBe('Copy');
    expect(jsonBtn?.textContent).toBe('Copy');

    // Auth header row.
    fireEvent.click(authBtn as HTMLElement);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith('Authorization: Bearer <YOUR_SILO_API_TOKEN>'),
    );

    // CLI row.
    fireEvent.click(cliBtn as HTMLElement);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        'claude mcp add --transport http silo http://127.0.0.1:8788/mcp --header "Authorization: Bearer <YOUR_SILO_API_TOKEN>"',
      ),
    );

    // JSON config row.
    fireEvent.click(jsonBtn as HTMLElement);
    await waitFor(() => {
      const lastCall = writeText.mock.calls[writeText.mock.calls.length - 1]?.[0] as string;
      expect(lastCall).toContain('"mcpServers"');
      expect(lastCall).toContain('<YOUR_SILO_API_TOKEN>');
    });
  });

  it('shows a skeleton in the URL row (not the localhost fallback) while appConfig is loading, with Copy disabled', async () => {
    const neverResolves = new Promise<Response>(() => {});
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/config')) return neverResolves;
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <McpSetupDialog onClose={() => {}} />
      </QueryClientProvider>,
    );

    // The dev-default fallback never appears — no pop once appConfig resolves.
    expect(screen.queryByText('http://127.0.0.1:8788/mcp')).toBeNull();
    expect(screen.getByText('URL')).toBeDefined();

    // Transport + Auth header don't depend on the late-resolving URL, so they
    // render immediately even while the URL/CLI/JSON rows are skeletons.
    expect(screen.getByText('Streamable HTTP')).toBeDefined();
    expect(screen.getByText('Authorization: Bearer <YOUR_SILO_API_TOKEN>')).toBeDefined();

    // Every Copy button tied to the url-dependent rows (URL, CLI, JSON) is
    // disabled while loading — Auth header's Copy stays enabled.
    const copyButtons = screen.getAllByRole('button', { name: 'Copy' });
    const disabledCount = copyButtons.filter((b) => (b as HTMLButtonElement).disabled).length;
    expect(disabledCount).toBe(3);
  });

  it('pressing Escape calls onClose', async () => {
    stubConfig();
    const onClose = vi.fn();
    renderDialog(onClose);

    await screen.findByText('http://127.0.0.1:8788/mcp');
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
