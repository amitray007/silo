import { z } from 'zod';
import { type CreateLinkInput, createLink, willDedupCapture } from './links.js';
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
 * `links` must be an ARRAY — but deliberately of `z.unknown()` elements, NOT
 * `linkSchema`-shaped objects. This is the "envelope tier" of the two-tier
 * validation (see the design spec's "Post-QA decisions": a structurally-
 * invalid single link must not fail the whole file). Per-element validation
 * against `linkSchema` happens INSIDE `importLinks`'s loop instead, so one
 * bad link becomes a per-link skip, not a whole-envelope rejection. Also
 * deliberately NOT `.strict()` — extra top-level keys the export envelope
 * also writes (`exportedAt`, `count`) are allowed and ignored, so import
 * accepts exactly what export produces without the two staying byte-for-byte
 * synced.
 */
const envelopeSchema = z.object({
  version: z.literal(1),
  links: z.array(z.unknown()),
});

/**
 * Ceiling on `links.length` in one import envelope. `importLinks` processes
 * the array SEQUENTIALLY, one `createLink` transaction per link — an
 * unbounded array from an authenticated-but-hostile (or just huge)
 * upload turns a single request into an unbounded amount of DB work, on top
 * of the route already buffering the whole JSON body into memory
 * (`c.req.json()`) before `importLinks` ever sees it. That's availability
 * self-harm even for a legitimate token holder (a fat-fingered or malicious
 * import blocks the single-user server for everyone else). 50,000 is a
 * generous ceiling for a personal link library — far above any real export
 * (see `export.ts`) — while still bounding worst-case memory/DB work to
 * something a personal-scale server can absorb.
 */
export const MAX_IMPORT_LINKS = 50_000;

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
 * Best-effort URL extraction for a skip record, from a raw (unvalidated)
 * envelope element — used only to make a `skipped[]` entry more useful to a
 * human scanning the import result. Returns `undefined` for anything that
 * isn't a plain object with a string `url` (e.g. the element is missing
 * `url` entirely, which is exactly the case this exists to still surface
 * SOMETHING useful for).
 */
function bestEffortUrl(element: unknown): string | undefined {
  if (typeof element !== 'object' || element === null) return undefined;
  const url = (element as { url?: unknown }).url;
  return typeof url === 'string' ? url : undefined;
}

/** Outcome of validating + writing one raw envelope element — see `importOneLink`. */
type ImportOneLinkResult =
  | { outcome: 'created' }
  | { outcome: 'merged' }
  | { outcome: 'skip'; skip: ImportSkip };

/**
 * Validate + write one raw envelope element. Returns the outcome so the
 * caller (`importLinks`) can update its running tallies — pulled out of the
 * main loop to keep `importLinks` under the cognitive-complexity ceiling
 * (see `docs/rules/typescript.md`). Never throws: both the per-link
 * `linkSchema.safeParse` failure and any error `createLink` throws (e.g. bad
 * `sourceData`) are caught here and turned into a `skip` outcome — that's
 * the whole point of the per-link tier (see `importLinks`'s doc comment).
 */
async function importOneLink(element: unknown, index: number): Promise<ImportOneLinkResult> {
  const parsedLink = linkSchema.safeParse(element);
  if (!parsedLink.success) {
    const url = bestEffortUrl(element);
    return {
      outcome: 'skip',
      skip:
        url === undefined
          ? { index, reason: parsedLink.error.message }
          : { index, url, reason: parsedLink.error.message },
    };
  }
  const link = parsedLink.data;
  try {
    const input = toCreateLinkInput(link);
    const existed = await willDedupCapture(link.url);
    await createLink(input);
    return { outcome: existed ? 'merged' : 'created' };
  } catch (error) {
    return {
      outcome: 'skip',
      skip: {
        index,
        url: link.url,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Restore a silo JSON export (the `version: 1` envelope `exportLinks`
 * produces) back into the store — the write half of the export/import
 * round-trip (design spec: `docs/superpowers/specs/2026-07-10-import-
 * design.md`).
 *
 * Validation posture (strict Zod, two tiers — the design spec's "Post-QA
 * decisions", locked after real-infra QA found the original one-tier
 * `z.array(linkSchema)` envelope schema made ONE structurally-invalid link
 * reject the WHOLE file):
 * - ENVELOPE failure (bad shape: missing `links`, `version !== 1`, `links`
 *   not an array, payload not an object) rejects the WHOLE file — throws
 *   `InvalidImportError`. A genuinely broken envelope is never partially
 *   applied.
 * - PER-LINK failure — EITHER a link that fails `linkSchema.safeParse`
 *   (structurally invalid: missing `url`, wrong-typed field, ...) OR a
 *   structurally-valid link `createLink` itself rejects (e.g. bad
 *   `sourceData`) — is caught and collected into `skipped` instead of
 *   failing the import. A backup with one malformed row still restores
 *   every good row.
 *
 * Dedup: reuses `createLink`'s existing canonical-URL dedup-merge wholesale
 * (no new write path). `willDedupCapture` pre-checks each link's URL BEFORE
 * calling `createLink`, purely to classify the outcome for the summary
 * (`existed` -> merged, else -> created) — it runs the SAME live-OR-trashed
 * lookup `createLink`'s own dedup target (`findExistingForDedup`) uses, so a
 * link that revives a trashed row is correctly counted as `merged`, not
 * `created` (a live-only check like `findByCanonicalUrl` would misreport
 * that case — see `willDedupCapture`'s doc comment in links.ts). `createLink`
 * itself remains the sole source of truth for what actually gets written;
 * this pre-check can theoretically race a concurrent writer (same caveat
 * `willDedupCapture` documents), which would misclassify a link's
 * created/merged count but never the stored data.
 *
 * Links are imported SEQUENTIALLY (not `Promise.all`): `createLink` runs its
 * own transaction per link, and import volumes are personal-scale, so
 * sequential keeps the created/merged classification race-free (no two
 * calls returning `existed: false` for the same not-yet-inserted URL) and
 * the code simple. A future large-import perf need could batch this —
 * parked, not needed now.
 *
 * Size cap: the envelope's `links` array is bounded to `MAX_IMPORT_LINKS` —
 * see that constant's doc comment for why (unbounded sequential
 * `createLink` transactions + a fully-buffered request body is an
 * availability self-harm vector even for an authenticated token holder).
 * Checked BEFORE the per-link loop starts, so an oversized file throws
 * `InvalidImportError` (whole-file rejection, consistent with the other
 * envelope-tier failures above) without doing any DB work.
 */
export async function importLinks(payload: unknown): Promise<ImportResult> {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new InvalidImportError(`invalid import envelope: ${parsed.error.message}`);
  }
  const { links } = parsed.data;

  if (links.length > MAX_IMPORT_LINKS) {
    throw new InvalidImportError(
      `import envelope has ${links.length} links, exceeding the ${MAX_IMPORT_LINKS} limit`,
    );
  }

  let created = 0;
  let merged = 0;
  const skipped: ImportSkip[] = [];

  for (let index = 0; index < links.length; index++) {
    const result = await importOneLink(links[index], index);
    if (result.outcome === 'created') {
      created++;
    } else if (result.outcome === 'merged') {
      merged++;
    } else {
      skipped.push(result.skip);
    }
  }

  return { version: 1, total: links.length, created, merged, skipped };
}
