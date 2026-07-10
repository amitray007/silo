/**
 * Capture-source provenance (capture-source slice): the SURFACE a link was
 * captured through, orthogonal to `Link['addedBy']` (who/user-vs-agent — see
 * `links.ts`'s `mergedOrigin` doc comment). This is the single source of
 * truth for the closed value set — mirrored (not re-declared) into
 * `@silo/db`'s `captureSource` pgEnum and, where each package's dependency
 * rules allow importing `@silo/core`, into the API's Zod schema and the MCP
 * read-surface shape. Packages that CANNOT import `@silo/core` (e.g. `web`)
 * hand-mirror the literal string values instead — see the method file's
 * "value-set drift guard" for the full list of mirror sites.
 */
export const CAPTURE_SOURCES = [
  'web',
  'mcp',
  'cli',
  'raycast',
  'chrome',
  'ingest',
  'unknown',
] as const;

export type CaptureSource = (typeof CAPTURE_SOURCES)[number];
