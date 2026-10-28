/** Pure capture contracts and URL classification. Safe to import in parser threads. */
import { z } from 'zod';

export { detectSource } from './links/detect-source.js';

// 3: the rendered path converts TeX to MathML (full Defuddle bundle).
export const READER_VERSION = 5;

export const READER_HTML_MAX_BYTES = 1024 * 1024;

const readerImageUrlSchema = z.httpUrl();

/** True when the Reader schema accepts this image URL. The worker sanitizer drops images that fail. */
export function isReaderImageUrl(url: string): boolean {
  return readerImageUrlSchema.safeParse(url).success;
}

/** HTML and its ordered image targets must always be written together. */
export const readerContentSchema = z.object({
  contentHtml: z
    .string()
    .min(1)
    .refine((html) => Buffer.byteLength(html) <= READER_HTML_MAX_BYTES),
  contentImages: z.array(readerImageUrlSchema).max(10_000),
});
export type ReaderContent = z.infer<typeof readerContentSchema>;
