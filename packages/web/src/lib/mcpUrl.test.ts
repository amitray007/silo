import { describe, expect, it } from 'vitest';
import { resolveMcpUrl } from './mcpUrl';

/**
 * Tests for `resolveMcpUrl` (deployable-silo slice, Unit 4) — the pure
 * precedence function behind "Copy config"'s URL: an operator-set
 * `SILO_PUBLIC_MCP_URL` wins outright; otherwise a non-localhost origin
 * derives `mcp.<hostname>`; otherwise (localhost dev) falls back to the
 * dev-default HTTP MCP listener address.
 */
describe('resolveMcpUrl', () => {
  it('an operator-set config URL wins verbatim, even on a non-localhost host', () => {
    const url = resolveMcpUrl('https://mcp.override.example/mcp', {
      hostname: 'silo.example.com',
      protocol: 'https:',
    });
    expect(url).toBe('https://mcp.override.example/mcp');
  });

  it('a real (non-localhost) hostname with no config override derives mcp.<hostname>', () => {
    const url = resolveMcpUrl(undefined, { hostname: 'silo.example.com', protocol: 'https:' });
    expect(url).toBe('https://mcp.silo.example.com/mcp');
  });

  it('localhost with no config override falls back to the dev-default 127.0.0.1:8788', () => {
    const url = resolveMcpUrl(undefined, { hostname: 'localhost', protocol: 'http:' });
    expect(url).toBe('http://127.0.0.1:8788/mcp');
  });

  it('127.0.0.1 with no config override falls back to the dev-default', () => {
    const url = resolveMcpUrl(undefined, { hostname: '127.0.0.1', protocol: 'http:' });
    expect(url).toBe('http://127.0.0.1:8788/mcp');
  });

  it('a *.localhost subdomain is treated as local dev, not derived', () => {
    const url = resolveMcpUrl(undefined, { hostname: 'app.localhost', protocol: 'http:' });
    expect(url).toBe('http://127.0.0.1:8788/mcp');
  });

  it('an empty hostname (e.g. a test/file:// origin) is treated as local dev, not derived', () => {
    const url = resolveMcpUrl(undefined, { hostname: '', protocol: 'file:' });
    expect(url).toBe('http://127.0.0.1:8788/mcp');
  });

  it('an empty-string config value is treated as unset, not used verbatim', () => {
    const url = resolveMcpUrl('', { hostname: 'silo.example.com', protocol: 'https:' });
    expect(url).toBe('https://mcp.silo.example.com/mcp');
  });
});
