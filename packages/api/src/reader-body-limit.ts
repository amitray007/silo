import { bodyLimit } from 'hono/body-limit';

/** Reader snapshots are small. Bound the stream before JSON parsing. */
export const readerBodyLimit = bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) =>
    c.json({ error: 'payload_too_large', message: 'Request body exceeds 16 KB' }, 413),
});
