import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  postgresReachable,
  setupMcpServerTest,
  teardownMcpServerTest,
} from './test-support/mcp-server-harness.js';

/**
 * Integration tests for `get_link`, driven end-to-end through a real MCP
 * client<->server pair (an in-memory linked transport, per the SDK's
 * `InMemoryTransport.createLinkedPair()`) against a real Postgres. This
 * proves the whole path: Zod input validation at the tool edge, the
 * `registerTool` wiring in `server.ts`, and `core.getById`'s live-scoping —
 * not just the handler function in isolation.
 *
 * Setup/teardown (the disposable database, migrations, and the linked
 * client<->server pair) is shared with `search-links.test.ts` via
 * `./test-support/mcp-server-harness.js` — see that module's doc comment for
 * the `DATABASE_URL`-then-dynamic-import rationale and the `test-support/`
 * carve-out in the `adapters-no-db` boundary (docs/rules/mcp.md).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('get_link (integration, via MCP client<->server)', () => {
  let core: typeof import('@silo/core');
  let pool: Pool;
  let client: Client;
  let dropDatabase: () => void;

  beforeAll(async () => {
    const ctx = await setupMcpServerTest('silo_mcp_get_link_test');
    core = ctx.core;
    pool = ctx.pool;
    client = ctx.client;
    dropDatabase = ctx.dropDatabase;
  });

  afterAll(async () => {
    await teardownMcpServerTest({ pool, dropDatabase });
  });

  async function newLink(url: string, tags?: string[]): Promise<string> {
    return tags
      ? (await core.createLink({ url, sourceKind: 'link', tags })).id
      : (await core.createLink({ url, sourceKind: 'link' })).id;
  }

  it('tools/list lists get_link (the capability went live)', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_link');
  });

  it('a real created + enriched link -> callTool returns its data incl. tags in structuredContent', async () => {
    const id = await newLink('https://example.com/get-link-found', ['reading', 'ai']);
    // Enrich directly via core (bypasses the worker/network — this test only
    // proves get_link's read path, not enrichment).
    await core.recordEnrichment(id, {
      title: 'A Great Article',
      description: 'A description',
      text: 'x'.repeat(200),
      status: 'full',
    });

    const result = await client.callTool({ name: 'get_link', arguments: { id } });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('A Great Article'),
      }),
    ]);

    // The SDK validates `structuredContent` against the tool's declared
    // `outputSchema` before returning it (SDK 1.29.0 `validateToolOutput`).
    // `callTool` resolving without `isError` on a found result IS the proof
    // that this structuredContent round-tripped through that validation —
    // a mismatch between `toStructuredContent`'s shape and `outputSchema`
    // would surface as a tool error here, not a silent pass.
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({
      found: true,
      id,
      url: 'https://example.com/get-link-found',
      title: 'A Great Article',
      description: 'A description',
      extractedText: 'x'.repeat(200),
      captureStatus: 'full',
      tags: ['ai', 'reading'],
    });
    expect(typeof structured.createdAt).toBe('string');
    expect(typeof structured.updatedAt).toBe('string');

    // Leak-absence: these internal-only `links` columns must never reach
    // structuredContent (previously leaked via a `{ ...rest }` spread that
    // stripped only `deletedAt`). Whitelist construction in
    // `toStructuredContent` makes this structural, not incidental.
    expect(structured).not.toHaveProperty('searchVector');
    expect(structured).not.toHaveProperty('canonicalUrl');
    expect(structured).not.toHaveProperty('sourceData');
    expect(structured).not.toHaveProperty('deletedAt');
  });

  it('a fresh, un-enriched link (null title/description, empty tags) -> honest nulls and empty-tags text', async () => {
    const id = await newLink('https://example.com/get-link-fresh');

    const result = await client.callTool({ name: 'get_link', arguments: { id } });
    expect(result.isError).toBeFalsy();

    // Text block falls back to the url (no title yet) and shows tags as
    // "(none)" rather than an empty/garbled list.
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('https://example.com/get-link-fresh'),
      }),
    ]);
    const [content] = result.content as Array<{ type: 'text'; text: string }>;
    expect(content?.text).toContain('tags: (none)');

    // structuredContent carries real JSON nulls, never the string
    // 'undefined' or a dropped key — and tags is an empty array, not
    // absent.
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.title).toBeNull();
    expect(structured.description).toBeNull();
    expect(structured.extractedText).toBeNull();
    expect(structured.tags).toEqual([]);
    expect(structured.captureStatus).toBe('enriching');

    expect(structured).not.toHaveProperty('searchVector');
    expect(structured).not.toHaveProperty('canonicalUrl');
    expect(structured).not.toHaveProperty('sourceData');
    expect(structured).not.toHaveProperty('deletedAt');
  });

  it('unknown uuid -> not-found result, NOT isError', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    const result = await client.callTool({ name: 'get_link', arguments: { id: unknownId } });
    expect(result.isError).toBeFalsy();
    // `outputSchema` is declared, so the SDK requires SOME structuredContent
    // on every non-error result (see `getLinkOutputShape`'s doc comment) —
    // `{ found: false }` is the honest not-found shape, not `undefined`.
    expect(result.structuredContent).toEqual({ found: false });
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(unknownId),
      }),
    ]);
  });

  it('a soft-deleted (trashed) link -> not-found (live-scoping)', async () => {
    const id = await newLink('https://example.com/get-link-trashed');
    await core.softDelete(id);

    const result = await client.callTool({ name: 'get_link', arguments: { id } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ found: false });
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('unknown or trashed'),
      }),
    ]);
  });

  it('a non-uuid id -> tool error (Zod validation at the edge)', async () => {
    // The SDK validates `inputSchema` before invoking the handler and surfaces
    // a failure as a RESOLVED CallToolResult with `isError: true` (an MCP
    // protocol-level tool error), not a rejected promise/thrown JS error —
    // confirmed empirically here. Our handler never runs; there is no
    // hand-rolled validation to write.
    const result = await client.callTool({ name: 'get_link', arguments: { id: 'not-a-uuid' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Invalid UUID'),
      }),
    ]);
  });
});
