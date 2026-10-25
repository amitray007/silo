/** Pure capture contracts and URL classification. Safe to import in parser threads. */
import { z } from 'zod';

export { detectSource } from './links/detect-source.js';

export const READER_HTML_MAX_BYTES = 1024 * 1024;

/** HTML and its ordered image targets must always be written together. */
export const readerContentSchema = z.object({
  contentHtml: z
    .string()
    .min(1)
    .refine((html) => Buffer.byteLength(html) <= READER_HTML_MAX_BYTES),
  contentImages: z.array(z.httpUrl()).max(10_000),
});
export type ReaderContent = z.infer<typeof readerContentSchema>;
