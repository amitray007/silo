import { expect, it } from 'vitest';
import { describeMcpTool, seedLink } from './test-support/mcp-server-harness.js';

// Integration tests for `export_links` via a real MCP client<->server pair
// against a real Postgres. Setup/teardown is shared via the harness module.
describeMcpTool(
  'silo_mcp_export_links_test',
  'export_links (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists export_links, and its description is present and non-empty', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const exportTool = tools.find((t) => t.name === 'export_links');
      expect(exportTool).toBeDefined();
      expect(typeof exportTool?.description).toBe('string');
      expect((exportTool?.description ?? '').length).toBeGreaterThan(0);
    });

    it('default format (no `format` arg): JSON body, structuredContent.format === "json"', async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/export-default', {
        title: 'Export default format',
        tags: ['exporttag'],
      });

      const result = await client.callTool({ name: 'export_links', arguments: {} });
      expect(result.isError).toBeFalsy();

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toBeTruthy();
      expect(content?.text.length).toBeGreaterThan(0);
      const parsed = JSON.parse(content?.text ?? '') as { count: number; links: unknown[] };
      expect(Array.isArray(parsed.links)).toBe(true);
      expect(parsed.count).toBe(parsed.links.length);

      const structured = result.structuredContent as { format: string; count: number };
      expect(structured.format).toBe('json');
      // outputSchema round-trip: `callTool` resolving without `isError` on
      // this result IS the proof structuredContent validated against
      // `exportLinksOutputShape` (SDK 1.29.0 `validateToolOutput`) — a
      // mismatch would surface as a tool error here, not a silent pass.
    });

    it('format: "csv" -> structuredContent.format === "csv", text starts with the UTF-8 BOM', async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/export-csv', {
        title: 'Export csv format',
      });

      const result = await client.callTool({
        name: 'export_links',
        arguments: { format: 'csv' },
      });
      expect(result.isError).toBeFalsy();

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      // The BOM is a real U+FEFF char in the returned string here — there is
      // no Fetch/HTTP decoding layer in this in-memory MCP transport to strip
      // or reinterpret it, unlike the API route's HTTP response.
      expect(content?.text.charCodeAt(0)).toBe(0xfeff);
      expect(content?.text).toContain(
        'id,url,canonicalUrl,title,description,siteName,sourceKind,captureStatus,addedBy,notes,createdAt,updatedAt,tags',
      );

      const structured = result.structuredContent as { format: string; count: number };
      expect(structured.format).toBe('csv');
    });

    it('format: "yaml" -> structuredContent.format === "yaml"', async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/export-yaml', {
        title: 'Export yaml format',
      });

      const result = await client.callTool({
        name: 'export_links',
        arguments: { format: 'yaml' },
      });
      expect(result.isError).toBeFalsy();

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toBeTruthy();
      expect(content?.text).toContain('version:');
      expect(content?.text).toContain('links:');

      const structured = result.structuredContent as { format: string; count: number };
      expect(structured.format).toBe('yaml');
    });
  },
);
