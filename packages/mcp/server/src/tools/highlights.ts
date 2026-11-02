import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AddHighlightInput, EditHighlightInput } from '@silo/core';
import {
  addHighlight,
  deleteHighlight,
  editHighlight,
  FeedPostNotEditableError,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_NOTE_MAX,
  HIGHLIGHT_QUOTE_MAX,
  InvalidHighlightError,
} from '@silo/core';
import { z } from 'zod';
import { highlightShape, toHighlightContent } from './link-shape.js';

/** Postgres text cannot hold a NUL byte. */
const noNul = (value: string) => !value.includes('\u0000');
const noNulMessage = { message: 'must not contain a NUL character' };

const colorField = z
  .enum(HIGHLIGHT_COLORS)
  .describe(
    `Highlight colour: ${HIGHLIGHT_COLORS.join(', ')}. Highlights may overlap, so a colour does not need to be unique.`,
  );

/** Every field optional, so `found: false` still validates (same pattern as `foundLinkOutputShape`). */
const highlightOutputShape = {
  found: z.boolean(),
  id: highlightShape.id.optional(),
  quote: highlightShape.quote.optional(),
  prefix: highlightShape.prefix.optional(),
  suffix: highlightShape.suffix.optional(),
  startOffset: highlightShape.startOffset.optional(),
  endOffset: highlightShape.endOffset.optional(),
  color: highlightShape.color.optional(),
  note: highlightShape.note.optional(),
  createdAt: highlightShape.createdAt.optional(),
  updatedAt: highlightShape.updatedAt.optional(),
};

/** Turn a core rule error into an agent-readable tool error; rethrow anything else. */
function ruleError(error: unknown): CallToolResult {
  if (error instanceof InvalidHighlightError || error instanceof FeedPostNotEditableError) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
  throw error;
}

function savedResult(
  highlight: Parameters<typeof toHighlightContent>[0],
  text: string,
): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { found: true, ...toHighlightContent(highlight) },
  };
}

function notFound(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: { found: false } };
}

/**
 * Registers `add_highlight`, `edit_highlight` and `delete_highlight`. Each is a
 * thin translation over the matching `@silo/core` call (the rules, quote
 * matching and the feed-post guard live in core). `get_link` returns the
 * highlights.
 */
export function registerHighlightTools(server: McpServer): void {
  server.registerTool(
    'add_highlight',
    {
      title: 'Add highlight',
      description:
        'Highlight a passage of a saved link, optionally with a note. Pass the link `id` and ' +
        "the exact `quote` copied from the link's `extractedText` (from `get_link`). Silo finds " +
        'the quote in the saved text (whitespace differences are ignored, case and punctuation ' +
        'must match) and the owner sees it highlighted in the Reader. If the quote appears more ' +
        'than once, `occurrence` picks the nth match (default 1). A quote that is not in the ' +
        'text is an error. Highlights may overlap: each one is its own range, so adding a ' +
        'highlight over an existing one is fine. `color` defaults to yellow. Feed posts cannot ' +
        'be highlighted: save them to Home first.',
      inputSchema: {
        id: z.uuid().describe('The link id (uuid).'),
        quote: z
          .string()
          .min(1)
          .max(HIGHLIGHT_QUOTE_MAX)
          .describe('The exact passage to highlight.'),
        occurrence: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Which match of the quote to use when it appears more than once. Default 1.'),
        color: colorField.optional(),
        note: z
          .string()
          .max(HIGHLIGHT_NOTE_MAX)
          .refine(noNul, noNulMessage)
          .optional()
          .describe('A note about the passage. Omit for a bare highlight.'),
      },
      outputSchema: highlightOutputShape,
    },
    async ({ id, quote, occurrence, color, note }): Promise<CallToolResult> => {
      const input: AddHighlightInput = { quote };
      if (occurrence !== undefined) input.occurrence = occurrence;
      if (color !== undefined) input.color = color;
      if (note !== undefined) input.note = note;
      try {
        const saved = await addHighlight(id, input);
        if (!saved) {
          return notFound(
            `No live link with id ${id} (unknown or trashed) - nothing was highlighted. ` +
              'Use list_links or search_links to find it.',
          );
        }
        return savedResult(
          saved,
          `Highlighted ${saved.color} on link ${id} (highlight id ${saved.id}). ` +
            'Use edit_highlight to change its colour or note, delete_highlight to remove it.',
        );
      } catch (error) {
        return ruleError(error);
      }
    },
  );

  server.registerTool(
    'edit_highlight',
    {
      title: 'Edit highlight',
      description:
        "Change a highlight's colour and/or note. Pass the highlight `id` (from `get_link`'s " +
        '`highlights`). Only the fields you pass change. `note: null` clears the note. The ' +
        'quote itself cannot change: delete the highlight and add a new one. Returns a clean ' +
        'not-found result (not an error) when the highlight is unknown or its link is trashed.',
      inputSchema: {
        id: z.uuid().describe('The highlight id (uuid).'),
        color: colorField.optional(),
        note: z
          .string()
          .max(HIGHLIGHT_NOTE_MAX)
          .refine(noNul, noNulMessage)
          .nullable()
          .optional()
          .describe('New note. `null` clears it. Omit to leave unchanged.'),
      },
      outputSchema: highlightOutputShape,
    },
    async ({ id, color, note }): Promise<CallToolResult> => {
      const patch: EditHighlightInput = {};
      if (color !== undefined) patch.color = color;
      if (note !== undefined) patch.note = note;
      try {
        const updated = await editHighlight(id, patch);
        if (!updated) {
          return notFound(
            `No highlight with id ${id} (unknown, or its link is trashed). Use get_link to list a link's highlights.`,
          );
        }
        return savedResult(
          updated,
          `Updated highlight ${id}. Call get_link with the link id to see all its highlights.`,
        );
      } catch (error) {
        return ruleError(error);
      }
    },
  );

  server.registerTool(
    'delete_highlight',
    {
      title: 'Delete highlight',
      description:
        'Delete one highlight and its note. This cannot be undone. The link and its other ' +
        'highlights are not touched. Pass the highlight `id` (from `get_link`).',
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: { id: z.uuid().describe('The highlight id (uuid).') },
      outputSchema: { deleted: z.boolean(), id: z.uuid() },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const deleted = await deleteHighlight(id);
        return {
          structuredContent: { deleted, id },
          content: [
            {
              type: 'text',
              text: deleted
                ? `Deleted highlight ${id}. Call get_link with the link id to see the remaining highlights.`
                : `No highlight with id ${id} (unknown, or its link is trashed). Use get_link to list a link's highlights.`,
            },
          ],
        };
      } catch (error) {
        return ruleError(error);
      }
    },
  );
}
