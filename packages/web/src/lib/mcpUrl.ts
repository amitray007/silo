/**
 * Resolves the MCP client-config URL for the "Copy config" button
 * (`AccessTab.tsx`, deployable-silo slice Unit 4). Precedence:
 *
 *   1. `configMcpUrl` (the API's `GET /api/config` `mcpUrl`, present only
 *      when the operator set `SILO_PUBLIC_MCP_URL`) — used verbatim when set.
 *   2. Else, if `location.hostname` is NOT a localhost-style host, derive
 *      `https://mcp.<hostname>/mcp` — the two-subdomain deploy shape
 *      (`silo.<domain>` + `mcp.silo.<domain>`, see the deployable-silo
 *      design doc) without needing an explicit override for the common case.
 *   3. Else (localhost dev, no override) fall back to the dev-default HTTP
 *      MCP listener address, `http://127.0.0.1:8788/mcp`.
 *
 * Pure function — `location` is passed in (a `{ hostname, protocol }` slice
 * of `window.location`, or a fake in tests) rather than read from `window`
 * directly, so this is unit-testable without a DOM/jsdom `location` stub.
 */
export function resolveMcpUrl(
  configMcpUrl: string | undefined,
  location: { hostname: string; protocol: string },
): string {
  if (configMcpUrl) return configMcpUrl;

  if (!isLocalhost(location.hostname)) {
    return `https://mcp.${location.hostname}/mcp`;
  }

  return 'http://127.0.0.1:8788/mcp';
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
