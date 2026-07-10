import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/silo_placeholder';
});

beforeEach(() => {
  delete process.env.SILO_PUBLIC_MCP_URL;
});

afterEach(() => {
  delete process.env.SILO_PUBLIC_MCP_URL;
});

/**
 * Tests for `GET /api/config` (deployable-silo slice, Unit 4) — the ungated
 * public config probe the web's MCP-URL resolver (`packages/web/src/lib/
 * mcpUrl.ts`) reads before falling back to its own `mcp.<hostname>`
 * derivation. Driven via `createApp()` + `app.request(...)` per
 * `docs/rules/api-hono.md`, mirroring `auth.test.ts`'s env set/restore
 * pattern. No DB harness needed — this route never touches the database.
 */
describe('GET /api/config', () => {
  it('SILO_PUBLIC_MCP_URL set: returns 200 { mcpUrl: "<value>" }', async () => {
    process.env.SILO_PUBLIC_MCP_URL = 'https://mcp.example.com/mcp';
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mcpUrl: 'https://mcp.example.com/mcp' });
  });

  it('SILO_PUBLIC_MCP_URL unset: returns 200 {} (no mcpUrl key)', async () => {
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
    expect(body).not.toHaveProperty('mcpUrl');
  });

  it('SILO_PUBLIC_MCP_URL set to blank/whitespace: treated as unset, returns 200 {}', async () => {
    process.env.SILO_PUBLIC_MCP_URL = '   ';
    const { createApp } = await import('../app.js');
    const app = createApp();
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('is reachable with no Authorization header even when the general API gate is configured (ungated, like /api/auth/check)', async () => {
    process.env.SILO_API_TOKEN = 'config-test-token-do-not-use-in-prod';
    process.env.SILO_PUBLIC_MCP_URL = 'https://mcp.example.com/mcp';
    try {
      const { createApp } = await import('../app.js');
      const app = createApp();
      const res = await app.request('/api/config');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mcpUrl: 'https://mcp.example.com/mcp' });
    } finally {
      delete process.env.SILO_API_TOKEN;
    }
  });
});
