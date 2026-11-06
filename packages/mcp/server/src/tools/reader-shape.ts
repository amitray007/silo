import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { InvalidCursorError, type ReadingPositionSource } from '@silo/core';
import { z } from 'zod';

export const compactLinkShape = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  url: z.string(),
  originalUrl: z.string(),
});
export const readingSourceShape = z.enum(['pencil', 'listen', 'mark']);
export const readerPageInputShape = {
  limit: z.number().int().optional().describe('Rows per page: default 20, clamped to 1..100.'),
  cursor: z
    .string()
    .optional()
    .describe('Opaque nextCursor from this tool. Omit for the first page.'),
};

export function readingSourceText(source: ReadingPositionSource): string {
  return { pencil: 'read to', listen: 'listened to', mark: 'saved place (Continue here)' }[source];
}

export function readerListError(error: unknown): CallToolResult {
  if (!(error instanceof InvalidCursorError)) throw error;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Invalid or expired cursor; omit cursor to restart from the first page.',
      },
    ],
  };
}
