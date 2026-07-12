import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `retry_capture` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, `core.requestRetry`'s live+retryable-scoping, the
// getById re-fetch/hydrate step), not the handler alone. Setup/teardown is
// shared via the harness module (see its doc comment for the rationale).
describeMcpTool(
  'silo_mcp_retry_capture_test',
  'retry_capture (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists retry_capture alongside the other 13 tools (14 total)', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('retry_capture');
      expect(names).toEqual(
        expect.arrayContaining([
          'get_link',
          'search_links',
          'list_links',
          'capture_link',
          'edit_link',
          'add_link_tag',
          'remove_link_tag',
          'export_links',
          // agent-navigation slice U4: the one genuinely new tool this slice
          // adds (see docs/superpowers/specs/2026-07-12-richer-query-
          // filters-design.md's guiding constraint) — every other change
          // enriches an existing tool's input/output instead.
          'find_related',
          // delete-tag slice: delete a tag from the ENTIRE library (distinct
          // from remove_link_tag, which only detaches a tag from one link).
          'delete_tag',
          // tag-tools slice: create a standalone (empty) tag ahead of time —
          // agent parity with the web '+ New tag' action.
          'create_tag',
        ]),
      );
      expect(names).toHaveLength(14);
    });

    // A degraded capture ('partial' or 'bare') is retryable: retry_capture
    // resets it to 'enriching' and returns the hydrated link. Both cases are
    // identical bar the seeded status, so they share one assertion body; this
    // also folds in the outputSchema round-trip check (createdAt/updatedAt
    // present + string-typed) rather than a separate dedicated test.
    for (const status of ['partial', 'bare'] as const) {
      it(`retrying a ${status} link -> found: true, status reset to enriching`, async () => {
        const { core, client } = getContext();
        const id = await seedLink(getContext, `https://example.com/retry-${status}`, {
          title: `${status} capture`,
          status,
        });

        const result = await client.callTool({ name: 'retry_capture', arguments: { id } });

        expect(result.isError).toBeFalsy();
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured).toMatchObject({ found: true, id, captureStatus: 'enriching' });
        expectNoLeakedFields(structured);
        expect(typeof structured.createdAt).toBe('string');
        expect(typeof structured.updatedAt).toBe('string');
        const [content] = result.content as Array<{ type: 'text'; text: string }>;
        expect(content?.text).toContain('get_link');

        // Verify via core directly that the row actually changed.
        const fetched = await core.getById(id);
        expect(fetched?.captureStatus).toBe('enriching');
      });
    }

    // The three ways `requestRetry` (core) returns null, none of which
    // mutate anything: unknown id, already-'full' (a good capture — not
    // retryable), and trashed (live-scoped guard). One shared assertion body
    // parameterized over how the not-found id is produced + what "untouched"
    // means for it, per this package's jscpd budget.
    const notFoundCases: Array<{
      name: string;
      textIncludes: string;
      setup: () => Promise<{ id: string; assertUntouched: () => Promise<void> }>;
    }> = [
      {
        name: 'a fully-captured link -> NOT retryable, status untouched',
        textIncludes: "'full'",
        setup: async () => {
          const { core } = getContext();
          const id = await seedLink(getContext, 'https://example.com/retry-full', {
            title: 'Full capture',
            status: 'full',
          });
          return {
            id,
            assertUntouched: async () => {
              const fetched = await core.getById(id);
              expect(fetched?.captureStatus).toBe('full');
            },
          };
        },
      },
      {
        name: 'an unknown uuid',
        textIncludes: 'unknown',
        setup: async () => ({
          id: '00000000-0000-0000-0000-000000000000',
          assertUntouched: async () => {},
        }),
      },
      {
        name: 'a trashed link -> found: false (live-scoped), row untouched',
        textIncludes: 'unknown',
        setup: async () => {
          const { core, pool } = getContext();
          const id = await seedLink(getContext, 'https://example.com/retry-trashed', {
            title: 'Trashed capture',
            status: 'partial',
          });
          await core.softDelete(id);
          return {
            id,
            // Queried via the harness's raw `pg.Pool` (not `core.getById`,
            // which is live-scoped and would return `null` for a trashed row
            // regardless of its status) — proves the trashed row still
            // reads 'partial', not flipped to 'enriching'.
            assertUntouched: async () => {
              const { rows } = await pool.query<{ captureStatus: string }>(
                'select capture_status as "captureStatus" from links where id = $1',
                [id],
              );
              expect(rows[0]?.captureStatus).toBe('partial');
            },
          };
        },
      },
    ];

    for (const { name, textIncludes, setup } of notFoundCases) {
      it(`retrying ${name} -> found: false`, async () => {
        const { client } = getContext();
        const { id, assertUntouched } = await setup();

        const result = await client.callTool({ name: 'retry_capture', arguments: { id } });

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({ found: false });
        const [content] = result.content as Array<{ type: 'text'; text: string }>;
        expect(content?.text).toContain(textIncludes);
        await assertUntouched();
      });
    }
  },
);
