/** The dev-default MCP listener address, used only for localhost. */
const LOCAL_MCP_URL = 'http://127.0.0.1:8788/mcp';

/**
 * Resolves the MCP client-config URL for the "Copy config" button
 * (`AccessTab.tsx`, deployable-silo slice Unit 4). Precedence:
 *
 *   1. `configMcpUrl` (the API's `GET /api/config` `mcpUrl`, present only
 *      when the operator set `SILO_PUBLIC_MCP_URL`) — used verbatim when set.
 *   2. Else, on a localhost-style host (dev), the dev-default HTTP MCP
 *      listener address, `http://127.0.0.1:8788/mcp`.
 *   3. Else (a real, non-localhost host with NO `SILO_PUBLIC_MCP_URL` set) —
 *      `undefined`. We deliberately do NOT guess a `https://mcp.<hostname>/mcp`
 *      subdomain: the MCP host is a pure deployment choice the code cannot
 *      infer (it has no public-suffix list, and the old `mcp.<host>` guess
 *      produced NESTED subdomains like `mcp.silo.<domain>` that break
 *      Cloudflare's single-level Universal SSL — the OAuth flow then dies at
 *      discovery; see docs/deploy.md). A hosted deployment MUST set
 *      `SILO_PUBLIC_MCP_URL` explicitly; the UI surfaces that when this is
 *      `undefined` rather than showing a wrong URL.
 *
 * Pure function — `location` is passed in (a `{ hostname, protocol }` slice
 * of `window.location`, or a fake in tests) rather than read from `window`
 * directly, so this is unit-testable without a DOM/jsdom `location` stub.
 */
export function resolveMcpUrl(
  configMcpUrl: string | undefined,
  location: { hostname: string; protocol: string },
): string | undefined {
  if (configMcpUrl) return configMcpUrl;

  if (isLocalhost(location.hostname)) return LOCAL_MCP_URL;

  return undefined;
}

/**
 * `true` for every hostname form a local dev server can be reached on:
 * `localhost`, `127.0.0.1`, the empty string (a `file://` origin or a test
 * environment with no `location` at all reports `hostname: ''`), and any
 * `*.localhost` subdomain (a valid loopback per RFC 6761, occasionally used
 * for named local dev setups).
 */
function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '' ||
    hostname.endsWith('.localhost')
  );
}
