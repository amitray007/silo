import { HIGHLIGHT_COLORS } from '@silo/db';
import { z } from 'zod';

/**
 * The synced reader preferences: one setting, `reader`, holding the defaults edited in
 * Settings → Reader. The dock uses per-article overrides. The bounds match the browser's own parsers (`packages/web/src/lib/
 * readerPrefs.ts`), which the web mirrors by hand because it must not import core.
 *
 * One field list, three wrappers, so the defaults and bounds live in one place:
 * - `write`: a full value; a missing field takes its default and an unknown or out-of-bounds
 *   field is rejected.
 * - `stored`: reads of a stored value; a bad field falls back to its default alone.
 * - `patch`: a partial value for `PATCH /api/settings`; every field optional, no defaults.
 */
type Mode = 'write' | 'stored' | 'patch';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const READER_DEFAULTS = {
  type: { font: 'inter', size: 16, leading: 'normal', theme: 'default' },
  width: 'medium',
  pencil: { style: 'underline', wpm: 240 },
  highlight: { color: 'yellow' },
  readAloud: { engine: 'phonon', voices: { phonon: '', kokoro: '' }, rate: 1, pauses: 'relaxed' },
} as const;

function wrappers<S extends z.ZodType>(
  schema: S,
  fallback: NoInfer<z.util.NoUndefined<z.output<S>>>,
) {
  return {
    write: schema.default(fallback),
    stored: schema.catch(fallback),
    patch: schema.optional(),
  };
}

function build<M extends Mode>(mode: M) {
  const field = <S extends z.ZodType>(
    schema: S,
    fallback: NoInfer<z.util.NoUndefined<z.output<S>>>,
  ) => wrappers(schema, fallback)[mode];
  const group = <S extends z.ZodRawShape>(
    shape: S,
    fallback: NoInfer<z.util.NoUndefined<z.output<z.ZodObject<S>>>>,
  ) => {
    // Unknown keys are an error on write and patch; a stored value just drops them.
    const object = z.object(shape);
    return mode === 'stored'
      ? wrappers(object, fallback)[mode]
      : wrappers(object.strict(), fallback)[mode];
  };
  const d = READER_DEFAULTS;
  const top = {
    type: group(
      {
        font: field(z.enum(['inter', 'serif', 'mono']), d.type.font),
        size: field(z.number().int().min(14).max(24), d.type.size),
        leading: field(z.enum(['compact', 'normal', 'relaxed']), d.type.leading),
        theme: field(z.enum(['default', 'sepia']), d.type.theme),
      },
      d.type,
    ),
    width: field(z.enum(['narrow', 'medium', 'wide']), d.width),
    pencil: group(
      {
        style: field(z.enum(['underline', 'highlighter']), d.pencil.style),
        wpm: field(z.number().int().min(100).max(600).multipleOf(20), d.pencil.wpm),
      },
      d.pencil,
    ),
    highlight: group({ color: field(z.enum(HIGHLIGHT_COLORS), d.highlight.color) }, d.highlight),
    readAloud: group(
      {
        engine: field(z.enum(['phonon', 'kokoro']), d.readAloud.engine),
        voices: group(
          {
            phonon: field(z.string().max(64), ''),
            kokoro: field(z.string().max(64), ''),
          },
          d.readAloud.voices,
        ),
        rate: field(z.literal(SPEEDS), d.readAloud.rate),
        pauses: field(z.enum(['short', 'relaxed', 'natural']), d.readAloud.pauses),
      },
      d.readAloud,
    ),
  };
  return mode === 'stored' ? z.object(top) : z.object(top).strict();
}

type ReaderShape = typeof readerSchema;

/** A complete reader value, as stored and returned. */
export type ReaderSettings = z.output<ReaderShape>;

export const readerSchema = build('write');
export const readerStoredSchema = build('stored');
export const readerPatchSchema = build('patch');

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lays `patch` over `base`, one level at a time, so an untouched field keeps its value. */
export function mergeReader(base: unknown, patch: unknown): unknown {
  if (!isPlain(base) || !isPlain(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    merged[key] = key in base ? mergeReader(base[key], value) : value;
  }
  return merged;
}

export type ReaderPrefs = z.output<typeof readerPatchSchema>;

/** Keep only stored override leaves, using the same per-field fallbacks as defaults reads. */
export function parseStoredReaderPrefs(value: unknown): ReaderPrefs {
  if (!isPlain(value)) return {};
  const stored = readerStoredSchema.parse(value);
  function present(raw: unknown, parsed: unknown): unknown {
    if (!isPlain(raw) || !isPlain(parsed)) return parsed;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key]) => Object.hasOwn(raw, key))
        .map(([key, child]) => [key, present(raw[key], child)]),
    );
  }
  return isPlain(value) ? (present(value, stored) as ReaderPrefs) : {};
}
