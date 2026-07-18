import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Tests for `readMcpHttpConfig`, the mcp-http-only entrypoint's pure
 * env-parsing/validation function (deployable-silo design, Unit 3 support).
 * Deliberately does NOT boot a real listener or touch `process.env`/
 * `process.exit` — `main()` itself is process wiring around this function,
 * not independently testable without spinning up a whole process; see
 * `mcp-http-main.ts`'s doc comment.
 *
 * `mcp-http-main.ts` transitively imports `@silo/mcp-server` -> `@silo/core`
 * -> `@silo/db`, whose client throws at MODULE-LOAD time if `DATABASE_URL` is
 * unset. `readMcpHttpConfig` itself never connects, so we point `DATABASE_URL`
 * at a syntactically valid placeholder and dynamically import the module AFTER
 * — same load-order discipline as `mcp-http.test.ts`, minus the real DB (this
 * suite makes no queries).
 */
let readMcpHttpConfig: typeof import('./mcp-http-main.js').readMcpHttpConfig;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://placeholder:placeholder@127.0.0.1:5432/placeholder';
  ({ readMcpHttpConfig } = await import('./mcp-http-main.js'));
});

describe('readMcpHttpConfig', () => {
  it('is invalid when SILO_MCP_HTTP_PORT is unset', () => {
    const result = readMcpHttpConfig({ SILO_API_TOKEN: 'tok' });
    expect(result.ok).toBe(false);
  });

  it('is invalid when SILO_MCP_HTTP_PORT is an empty string', () => {
    const result = readMcpHttpConfig({ SILO_MCP_HTTP_PORT: '', SILO_API_TOKEN: 'tok' });
    expect(result.ok).toBe(false);
  });

  it.each(['0', '-1', '70000', '3.14', 'not-a-number', ' '])(
    'is invalid for out-of-range/non-integer port %s',
    (rawPort) => {
      const result = readMcpHttpConfig({ SILO_MCP_HTTP_PORT: rawPort, SILO_API_TOKEN: 'tok' });
      expect(result.ok).toBe(false);
    },
  );

  it('is invalid when SILO_API_TOKEN is unset, even with a valid port', () => {
    const result = readMcpHttpConfig({ SILO_MCP_HTTP_PORT: '8788' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/SILO_API_TOKEN/);
    }
  });

  it('is invalid when SILO_API_TOKEN is an empty string', () => {
    const result = readMcpHttpConfig({ SILO_MCP_HTTP_PORT: '8788', SILO_API_TOKEN: '' });
    expect(result.ok).toBe(false);
  });

  it('is valid with just a port and token, defaulting host to 127.0.0.1 and allowed-hosts to empty', () => {
    const result = readMcpHttpConfig({ SILO_MCP_HTTP_PORT: '8788', SILO_API_TOKEN: 'tok' });
    expect(result).toEqual({
      ok: true,
      config: { port: 8788, token: 'tok', host: '127.0.0.1', extraAllowedHosts: [] },
    });
  });

  it('honors an explicit SILO_MCP_HTTP_HOST (the container sets 0.0.0.0)', () => {
    const result = readMcpHttpConfig({
      SILO_MCP_HTTP_PORT: '8788',
      SILO_API_TOKEN: 'tok',
      SILO_MCP_HTTP_HOST: '0.0.0.0',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.host).toBe('0.0.0.0');
    }
  });

  it('splits, trims, and drops empty entries from SILO_MCP_ALLOWED_HOSTS', () => {
    const result = readMcpHttpConfig({
      SILO_MCP_HTTP_PORT: '8788',
      SILO_API_TOKEN: 'tok',
      SILO_MCP_ALLOWED_HOSTS: ' mcp.silo.example.com , mcp.other.example.com ,,',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.extraAllowedHosts).toEqual([
        'mcp.silo.example.com',
        'mcp.other.example.com',
      ]);
    }
  });

  it('defaults extraAllowedHosts to an empty array when SILO_MCP_ALLOWED_HOSTS is unset', () => {
    const result = readMcpHttpConfig({ SILO_MCP_HTTP_PORT: '8788', SILO_API_TOKEN: 'tok' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.extraAllowedHosts).toEqual([]);
    }
  });
});
