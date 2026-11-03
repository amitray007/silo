import { bodyLimit } from 'hono/body-limit';

export const READER_BODY_LIMIT_BYTES = 16 * 1024;

/** Reader snapshots are small. Bound the stream before JSON parsing. */
export const readerBodyLimit = bodyLimit({
  maxSize: READER_BODY_LIMIT_BYTES,
  onError: (c) =>
    c.json({ error: 'payload_too_large', message: 'Request body exceeds 16 KB' }, 413),
});
