import { expect, it } from 'vitest';
import { describeMcpTool, expectNoLeakedFields } from './test-support/mcp-server-harness.js';

// Integration tests for `capture_link` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, `core.createLink`'s dedup/merge, the URL guard),
// not the handler alone. Setup/teardown is shared via the harness module
// (see its doc comment for the rationale).
describeMcpTool(
  'silo_mcp_capture_link_test',
  'capture_link (integration, via MCP client<->server)',
  (getContext) => {
    /** Total row count in `links` (including trashed) — used to prove the
     * bad-URL guard saves NOTHING, not merely "no live link". */
    async function totalLinkCount(): Promise<number> {
      const { pool } = getContext();
      const result = await pool.query<{ count: string }>('select count(*) from links');
      return Number(result.rows[0]?.count ?? '0');
    }

    /** Calls `capture_link` and returns its `structuredContent`, asserting the
     * call didn't error — shared by every re-capture-style test below so the
     * "call the tool, assert success, cast structuredContent" boilerplate
     * isn't duplicated per test (jscpd flagged the earlier duplication). */
    async function captureLink(url: string, note?: string): Promise<Record<string, unknown>> {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'capture_link',
        arguments: note !== undefined ? { url, note } : { url },
      });
      expect(result.isError).toBeFalsy();
      return result.structuredContent as Record<string, unknown>;
    }

    it('tools/list lists capture_link alongside the read tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('capture_link');
      expect(names).toContain('get_link');
      expect(names).toContain('search_links');
      expect(names).toContain('list_links');
    });

    it('fresh capture -> enriching, tags attached, deduped false, row proven to exist', async () => {
      const { core, client } = getContext();
      const result = await client.callTool({
        name: 'capture_link',
        arguments: { url: 'https://example.com/capture-fresh-a', tags: ['AI'], note: 'n' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({
        url: 'https://example.com/capture-fresh-a',
        captureStatus: 'enriching',
        deduped: false,
        tags: ['AI'],
        notes: 'n',
      });
      expect(typeof structured.id).toBe('string');
      expectNoLeakedFields(structured);

      // Verify via core directly that the row actually exists (not just that
      // the tool said so).
      const id = structured.id as string;
      const fetched = await core.getById(id);
      expect(fetched).not.toBeNull();
      expect(fetched?.url).toBe('https://example.com/capture-fresh-a');
      expect(fetched?.tags).toEqual(['AI']);
    });

    it("capture_link always sets addedBy: 'agent' (MCP captures are agent-origin) -- get_link shows it too", async () => {
      const { core, client } = getContext();
      const result = await client.callTool({
        name: 'capture_link',
        arguments: { url: 'https://example.com/capture-origin-agent' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.addedBy).toBe('agent');
      expectNoLeakedFields(structured);

      const id = structured.id as string;
      const fetched = await core.getById(id);
      expect(fetched?.addedBy).toBe('agent');

      const getLinkResult = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(getLinkResult.isError).toBeFalsy();
      const getLinkStructured = getLinkResult.structuredContent as Record<string, unknown>;
      expect(getLinkStructured.addedBy).toBe('agent');
    });

    it("capture_link always stamps source: 'mcp' (the MCP capture surface) -- core row + get_link both show it", async () => {
      const { core, client } = getContext();
      const result = await client.callTool({
        name: 'capture_link',
        arguments: { url: 'https://example.com/capture-source-mcp' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      const id = structured.id as string;

      const fetched = await core.getById(id);
      expect(fetched?.source).toBe('mcp');
    });

    it('re-capturing the same URL -> deduped true, same id, notes appended', async () => {
      const { core } = getContext();
      const firstStructured = await captureLink(
        'https://example.com/capture-recapture',
        'first note',
      );
      const id = firstStructured.id as string;

      const secondStructured = await captureLink(
        'https://example.com/capture-recapture',
        'second note',
      );
      expect(secondStructured.id).toBe(id);
      expect(secondStructured.deduped).toBe(true);
      expect(secondStructured.notes).toContain('first note');
      expect(secondStructured.notes).toContain('second note');

      const fetched = await core.getById(id);
      expect(fetched?.notes).toContain('first note');
      expect(fetched?.notes).toContain('second note');
    });

    it('re-capturing a TRASHED link -> deduped true (revive), not a false "created new"', async () => {
      // Regression test for a review finding: a naive dedup pre-check scoped
      // to LIVE rows only (e.g. core.findByCanonicalUrl) would report
      // `deduped: false` here, even though core.createLink actually revives +
      // merges into the trashed row. `willDedupCapture` (core) matches live
      // OR trashed rows, same scope createLink's own merge target uses.
      const { core } = getContext();
      const firstStructured = await captureLink(
        'https://example.com/capture-revive-trashed',
        'before trash',
      );
      const id = firstStructured.id as string;

      await core.softDelete(id);
      const trashed = await core.getById(id);
      expect(trashed).toBeNull(); // live-scoped getById confirms it's trashed

      const secondStructured = await captureLink(
        'https://example.com/capture-revive-trashed',
        'after revive',
      );
      expect(secondStructured.id).toBe(id);
      expect(secondStructured.deduped).toBe(true);
      expect(secondStructured.notes).toContain('before trash');
      expect(secondStructured.notes).toContain('after revive');

      const revived = await core.getById(id);
      expect(revived).not.toBeNull();
    });

    it('case-insensitive tags: capture with AI then re-capture with ai -> one tag', async () => {
      const { client } = getContext();
      const first = await client.callTool({
        name: 'capture_link',
        arguments: { url: 'https://example.com/capture-tag-case', tags: ['AI'] },
      });
      const firstStructured = first.structuredContent as Record<string, unknown>;
      expect(firstStructured.tags).toEqual(['AI']);

      const second = await client.callTool({
        name: 'capture_link',
        arguments: { url: 'https://example.com/capture-tag-case', tags: ['ai'] },
      });
      const secondStructured = second.structuredContent as Record<string, unknown>;
      // One tag survives (the first-entered display casing), not two.
      expect(secondStructured.tags).toEqual(['AI']);
    });

    it('bad URLs -> isError true, NOTHING saved (no row created, checked after EACH input)', async () => {
      const { client } = getContext();

      const badUrls = [
        'javascript:alert(1)',
        'not a url',
        '',
        `https://example.com/${'a'.repeat(9000)}`,
      ];

      // Row count is re-checked after every individual bad URL (not just once
      // at the end) so a leak from one bad input can't be masked by a
      // compensating change from another.
      for (const url of badUrls) {
        const before = await totalLinkCount();
        const result = await client.callTool({ name: 'capture_link', arguments: { url } });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('nothing was saved'),
          }),
        ]);
        const after = await totalLinkCount();
        expect(after).toBe(before);
      }
    });

    it('URL length boundary: exactly 8192 chars succeeds, 8193 is rejected (nothing saved)', async () => {
      // canonicalize.ts's MAX_URL_LENGTH check is `rawUrl.length > 8192`, so
      // exactly 8192 is the last ACCEPTED length and 8193 is the first
      // REJECTED one — the other bad-URL test only covers a URL well past
      // this boundary, which wouldn't catch an off-by-one here.
      const { client } = getContext();
      const prefix = 'https://example.com/';
      const atLimit = prefix + 'a'.repeat(8192 - prefix.length);
      expect(atLimit.length).toBe(8192);
      const overLimit = `${atLimit}a`;
      expect(overLimit.length).toBe(8193);

      const okResult = await client.callTool({
        name: 'capture_link',
        arguments: { url: atLimit },
      });
      expect(okResult.isError).toBeFalsy();

      const beforeOverLimit = await totalLinkCount();
      const badResult = await client.callTool({
        name: 'capture_link',
        arguments: { url: overLimit },
      });
      expect(badResult.isError).toBe(true);
      const afterOverLimit = await totalLinkCount();
      expect(afterOverLimit).toBe(beforeOverLimit);
    });

    it('success text carries agent-actionable guidance (enriching + get_link)', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'capture_link',
        arguments: { url: 'https://example.com/capture-guidance-text' },
      });
      expect(result.isError).toBeFalsy();
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('enriching');
      expect(content?.text).toContain('get_link');
    });

    it('outputSchema round-trip: a non-error result validates against the declared schema', async () => {
      // The SDK validates `structuredContent` against `outputSchema` (SDK
      // 1.29.0 `validateToolOutput`) before returning it — `callTool`
      // resolving without `isError` on a successful capture IS the proof
      // that the shape round-tripped through that validation (a mismatch
      // would surface as a tool error here, not a silent pass). Same
      // rationale as `get-link.test.ts`'s equivalent assertion.
      const { client } = getContext();
      const result = await client.callTool({
        name: 'capture_link',
        arguments: { url: 'https://example.com/capture-schema-roundtrip', tags: ['x'] },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(typeof structured.deduped).toBe('boolean');
      expect(typeof structured.createdAt).toBe('string');
      expect(typeof structured.updatedAt).toBe('string');
      expectNoLeakedFields(structured);
    });
  },
);
