import { z } from 'zod';
import { type CreateLinkInput, createLink, findByCanonicalUrl } from './links.js';
import type { SourceData } from './source-data.js';

/** One link from the envelope that failed to import, with why. */
export type ImportSkip = { index: number; url?: string; reason: string };

/** The summary `importLinks` returns — drives the API response and the web UI's result line. */
export type ImportResult = {
  version: 1;
  /** Links present in the envelope (created + merged + skipped.length). */
  total: number;
  created: number;
  merged: number;
  skipped: ImportSkip[];
};

/**
 * Thrown when the top-level import payload isn't a valid `version: 1`
 * envelope (bad JSON is the caller's problem — this is for a parsed-but-
 * wrong-shape value: missing `links`, `version !== 1`, not an object). A
 * structurally broken file is rejected whole, never partially applied — see
 * the design spec's "envelope-level failure = reject the whole file".
 */
export class InvalidImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImportError';
  }
}

/**
 * Per-link shape, mirroring `export.ts`'s `toExportedLink` output (the
 * exported object is exactly what import must accept). `id`/`createdAt`/
 * `updatedAt`/`captureStatus` are present on an exported link but IGNORED
 * here — import always mints a fresh row via `createLink`, which owns id
 * assignment and dedup (see the design spec's "id handling"). `sourceData`'s
 * INNER shape is deliberately not validated here (`z.record(z.unknown())`) —
 * `createLink` re-validates it against the strict `sourceDataSchema` union,
 * and a bad payload throws there, which the per-link try/catch below turns
 * into a skip rather than failing the whole import.
 */
const linkSchema = z.object({
  url: z.string(),
  sourceKind: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  siteName: z.string().nullable().optional(),
  extractedText: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  sourceData: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string()).optional(),
  addedBy: z.enum(['user', 'agent']).optional(),
});

type ImportLink = z.infer<typeof linkSchema>;

/**
 * The envelope schema import gates on: `version` must be the literal `1`
 * (silo's own export version — see `export.ts`'s `EXPORT_VERSION`), and
 * `links` must be an array of `linkSchema`-shaped objects. Deliberately NOT
 * `.strict()` — extra top-level keys the export envelope also writes
 * (`exportedAt`, `count`) are allowed and ignored, so import accepts exactly
 * what export produces without the two staying byte-for-byte synced.
 */
const envelopeSchema = z.object({
  version: z.literal(1),
  links: z.array(linkSchema),
});

/**
 * The exported shape's nullable-string metadata fields — each must be
 * omitted from `CreateLinkInput` (not passed through as `null`), since
 * `CreateLinkInput`'s fields are `string | undefined`, not
 * `string | null | undefined`. Named as a tuple of `[importKey, inputKey]`
 * pairs so `toCreateLinkInput` can loop instead of repeating the same
 * null-check five times (keeps it under the cognitive-complexity ceiling).
 */
const NULLABLE_STRING_FIELDS = [
  ['title', 'title'],
  ['description', 'description'],
  ['imageUrl', 'imageUrl'],
  ['siteName', 'siteName'],
  ['extractedText', 'extractedText'],
  ['notes', 'notes'],
] as const satisfies ReadonlyArray<readonly [keyof ImportLink, keyof CreateLinkInput]>;

/**
 * Build a `CreateLinkInput` from one parsed import link. Conditional
 * assignment throughout (mirrors `packages/api/src/routes/ingest.ts`'s
 * `toCreateLinkInput`) — `exactOptionalPropertyTypes` rejects an explicit
 * `undefined` on an optional field. `addedBy` maps to `origin` — an
 * `addedBy: 'agent'` link re-imports as agent-added, preserving the `◆` mark.
 */
function toCreateLinkInput(link: ImportLink): CreateLinkInput {
  const input: CreateLinkInput = {
    url: link.url,
    sourceKind: link.sourceKind,
  };

  for (const [importKey, inputKey] of NULLABLE_STRING_FIELDS) {
    const value = link[importKey];
    if (value !== undefined && value !== null) {
      input[inputKey] = value;
    }
  }

  if (link.sourceData !== undefined && link.sourceData !== null) {
    // Cast through the strict `SourceData` union (not `CreateLinkInput['sourceData']`,
    // which is `SourceData | undefined` and trips `exactOptionalPropertyTypes`
    // on assignment to this narrowed, definitely-not-undefined field): this
    // record is UNVALIDATED against that union at this point — `createLink`
    // runs it through the real `sourceDataSchema.parse` and throws on a bad
    // payload, which the per-link try/catch in `importLinks` turns into a
    // skip. See the module doc comment above.
    input.sourceData = link.sourceData as SourceData;
  }
  if (link.tags !== undefined) input.tags = link.tags;
  if (link.addedBy !== undefined) input.origin = link.addedBy;
  return input;
}

/**
 * Restore a silo JSON export (the `version: 1` envelope `exportLinks`
 * produces) back into the store — the write half of the export/import
 * round-trip (design spec: `docs/superpowers/specs/2026-07-10-import-
 * design.md`).
 *
 * Validation posture (strict Zod, two tiers — the design spec's locked
 * decision):
 * - ENVELOPE failure (bad shape: missing `links`, `version !== 1`, not an
 *   object) rejects the WHOLE file — throws `InvalidImportError`. A
 *   structurally broken file is never partially applied.
 * - PER-LINK failure (e.g. a link missing `url`, or a `sourceData` payload
 *   `createLink` rejects) is caught and collected into `skipped` — a backup
 *   with one malformed row still restores every good row.
 *
 * Dedup: reuses `createLink`'s existing canonical-URL dedup-merge wholesale
 * (no new write path). `findByCanonicalUrl` pre-checks each link's URL
 * BEFORE calling `createLink`, purely to classify the outcome for the
 * summary (`existed` -> merged, else -> created) — `createLink` itself is
 * the sole source of truth for what actually gets written; this pre-check
 * can theoretically race a concurrent writer (same caveat `willDedupCapture`
 * documents), which would misclassify a link's created/merged count but
 * never the stored data.
 *
 * Links are imported SEQUENTIALLY (not `Promise.all`): `createLink` runs its
 * own transaction per link, and import volumes are personal-scale, so
 * sequential keeps the created/merged classification race-free (no two
 * calls returning `existed: false` for the same not-yet-inserted URL) and
 * the code simple. A future large-import perf need could batch this —
 * parked, not needed now.
 */
export async function importLinks(payload: unknown): Promise<ImportResult> {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new InvalidImportError(`invalid import envelope: ${parsed.error.message}`);
  }
  const { links } = parsed.data;

  let created = 0;
  let merged = 0;
  const skipped: ImportSkip[] = [];

  for (let index = 0; index < links.length; index++) {
    const link = links[index];
    if (!link) continue;
    try {
      const input = toCreateLinkInput(link);
      const existed = (await findByCanonicalUrl(link.url)) !== null;
      await createLink(input);
      if (existed) {
        merged++;
      } else {
        created++;
      }
    } catch (error) {
      skipped.push({
        index,
        url: link.url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { version: 1, total: links.length, created, merged, skipped };
}
