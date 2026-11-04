import { describe, expect, it } from 'vitest';
import { readerPatchSchema, readerSchema } from './reader.js';
import {
  normalizePluginsValue,
  parseSettingValue,
  parseStoredSettingValue,
  SETTINGS_DEFAULTS,
} from './schema.js';

/**
 * Unit tests for the `plugins` schema + its plan-026 legacy-shape migration
 * (see `schema.ts`'s doc comments). Pure/synchronous — no Postgres needed,
 * unlike `settings.test.ts`'s integration suite; these exercise
 * `normalizePluginsValue` and `parseSettingValue` directly.
 */
describe('normalizePluginsValue (plan 026 migration)', () => {
  it('upgrades a fully-legacy boolean blob to the new per-feature shape', () => {
    expect(normalizePluginsValue({ hacker_news: true, github: false, youtube: true })).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: false, hover: false, palette: false },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: SETTINGS_DEFAULTS.plugins.twitter,
    });
  });

  it('a source already in the new shape passes through untouched', () => {
    const value = {
      hacker_news: { enabled: true, inline: false, hover: true, palette: true },
      github: { enabled: false, hover: false, palette: false },
      youtube: { enabled: true, hover: false, palette: true },
      twitter: { enabled: false, inline: true, hover: true, palette: false },
    };
    expect(normalizePluginsValue(value)).toEqual(value);
  });

  it('a mix of legacy booleans and new-shape objects normalizes each source independently', () => {
    expect(
      normalizePluginsValue({
        hacker_news: true,
        github: { enabled: false, hover: true },
        youtube: false,
        twitter: { enabled: true, inline: false, hover: false },
      }),
    ).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: false, hover: true, palette: true },
      youtube: { enabled: false, hover: false, palette: false },
      twitter: { enabled: true, inline: false, hover: false, palette: true },
    });
  });

  it('a missing source key falls back to that source default, independent of its siblings', () => {
    expect(normalizePluginsValue({ github: true })).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true, palette: true },
      youtube: SETTINGS_DEFAULTS.plugins.youtube,
      twitter: SETTINGS_DEFAULTS.plugins.twitter,
    });
  });

  it('a pre-twitter stored blob (no `twitter` key at all) migrates to include the twitter default', () => {
    // Exactly the shape a real pre-plan-026-twitter install has sitting in
    // its `settings` table: hacker_news/github/youtube already in the new
    // per-feature shape, but written before `twitter` joined the allowlist —
    // `twitter` is entirely absent, not just legacy-shaped.
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
      }),
    ).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: SETTINGS_DEFAULTS.plugins.twitter,
    });
  });

  it('a partial/garbage object for one source falls back to that source default without affecting others', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: true }, // missing hover — too-partial
        github: true,
        youtube: { enabled: 'yes', hover: true }, // wrong types — garbage
        twitter: { enabled: true, inline: true, hover: true }, // pre-palette shape — fills forward
      }),
    ).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true, palette: true },
      youtube: SETTINGS_DEFAULTS.plugins.youtube,
      twitter: { enabled: true, inline: true, hover: true, palette: true },
    });
  });

  it('an extra unknown field on a source object is treated as garbage and falls back to default', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: true, inline: true, hover: true, extra: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true },
      }),
    ).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: true, hover: true, palette: true },
    });
  });

  it('a pre-inline stored twitter blob (`{enabled,hover}`) now fills forward its missing fields (inline+palette) instead of resetting — additive migration preserves the stored enabled/hover choice', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: false, hover: false }, // pre-inline twitter shape (2 keys)
      }),
    ).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      // enabled/hover preserved from storage; inline + palette filled from default
      twitter: { enabled: false, inline: true, hover: false, palette: true },
    });
  });

  it('fills a missing `palette` field forward, preserving prior enabled/inline/hover choices', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: false, inline: false, hover: true }, // pre-palette shape
        github: { enabled: true, hover: false },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: false, hover: true },
      }),
    ).toEqual({
      hacker_news: { enabled: false, inline: false, hover: true, palette: true },
      github: { enabled: true, hover: false, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: false, hover: true, palette: true },
    });
  });

  it('a too-partial source (missing hover) still falls back to that source default', () => {
    expect(normalizePluginsValue({ hacker_news: { enabled: true } })).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: SETTINGS_DEFAULTS.plugins.github,
      youtube: SETTINGS_DEFAULTS.plugins.youtube,
      twitter: SETTINGS_DEFAULTS.plugins.twitter,
    });
  });

  it('completely missing/garbage top-level value is returned unchanged (parseSettingValue then falls back to the whole-key default)', () => {
    expect(normalizePluginsValue(undefined)).toBeUndefined();
    expect(normalizePluginsValue(null)).toBeNull();
    expect(normalizePluginsValue('not-an-object')).toBe('not-an-object');
  });
});

describe('mcpAccess schema validation (via parseSettingValue)', () => {
  it('accepts true', () => {
    expect(parseSettingValue('mcpAccess', true)).toBe(true);
  });

  it('accepts false', () => {
    expect(parseSettingValue('mcpAccess', false)).toBe(false);
  });

  it('rejects a non-boolean value (string)', () => {
    expect(() => parseSettingValue('mcpAccess', 'yes')).toThrow();
  });

  it('rejects a non-boolean value (number)', () => {
    expect(() => parseSettingValue('mcpAccess', 1)).toThrow();
  });

  it('rejects a non-boolean value (null)', () => {
    expect(() => parseSettingValue('mcpAccess', null)).toThrow();
  });

  it('SETTINGS_DEFAULTS.mcpAccess defaults to true (existing behavior unchanged for the HTTP MCP gate)', () => {
    expect(SETTINGS_DEFAULTS.mcpAccess).toBe(true);
  });
});

describe('plugins schema validation (via parseSettingValue)', () => {
  it('accepts the new nested per-feature shape', () => {
    const value = {
      hacker_news: { enabled: true, inline: false, hover: true, palette: true },
      github: { enabled: false, hover: false, palette: false },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: false, inline: true, hover: true, palette: false },
    };
    expect(parseSettingValue('plugins', value)).toEqual(value);
  });

  it('a stray field on a per-source object is treated as an unrecognized/garbage shape and that source falls back to its default (does not throw — the migration normalizer is lenient per-source by design)', () => {
    expect(
      parseSettingValue('plugins', {
        hacker_news: { enabled: true, inline: true, hover: true, evil: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        twitter: { enabled: true, inline: true, hover: true },
      }),
    ).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: true, hover: true, palette: true },
    });
  });

  it('rejects a stray top-level plugin key (.strict())', () => {
    expect(() =>
      parseSettingValue('plugins', {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
        evil: { enabled: true },
      }),
    ).toThrow();
  });

  it('a legacy boolean blob parses successfully via the read-time migration, filling in the twitter default (a legacy blob predates twitter entirely)', () => {
    expect(
      parseSettingValue('plugins', { hacker_news: true, github: false, youtube: true }),
    ).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: false, hover: false, palette: false },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: SETTINGS_DEFAULTS.plugins.twitter,
    });
  });

  it('SETTINGS_DEFAULTS.plugins is all-true (every field on, matching pre-026 enabled-by-default)', () => {
    expect(SETTINGS_DEFAULTS.plugins).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true, palette: true },
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: true, hover: true, palette: true },
    });
  });
});

describe('hoverPreview schema and default', () => {
  it('defaults to off', () => {
    expect(SETTINGS_DEFAULTS.hoverPreview).toBe(false);
  });

  it.each([true, false])('accepts %s', (value) => {
    expect(parseSettingValue('hoverPreview', value)).toBe(value);
  });

  it.each(['true', 1, null, undefined, {}])('rejects non-boolean %j', (value) => {
    expect(() => parseSettingValue('hoverPreview', value)).toThrow();
  });
});

describe('reader setting schema', () => {
  it('distinguishes full, stored and partial reader schemas', async () => {
    const { readerSchema, readerStoredSchema, readerPatchSchema } = await import('./reader.js');
    const partial = readerPatchSchema.parse({ readAloud: { voices: { kokoro: 'af_heart' } } });
    expect(partial).toEqual({ readAloud: { voices: { kokoro: 'af_heart' } } });
    const full = readerSchema.parse(partial);
    // Typed field access also guards the inferred output of every schema mode.
    expect(full.readAloud.voices.phonon).toBe('');
    expect(full.type.size).toBe(16);
    expect(readerStoredSchema.parse({ type: { size: 'bad', font: 'mono' } }).type.font).toBe(
      'mono',
    );
    expect(() => readerPatchSchema.parse({ type: { unknown: true } })).toThrow();
  });

  it('defaults to unset, and an empty value fills every field default', () => {
    expect(SETTINGS_DEFAULTS.reader).toBeNull();
    expect(parseSettingValue('reader', {})).toEqual({
      type: { font: 'inter', size: 16, leading: 'normal', theme: 'default' },
      width: 'medium',
      pencil: { style: 'underline', wpm: 240 },
      highlight: { color: 'yellow' },
      readAloud: {
        engine: 'phonon',
        pauses: 'relaxed',
        voices: { phonon: '', kokoro: '' },
        rate: 1,
      },
    });
  });

  it.each([
    [{ type: { size: 14 } }],
    [{ type: { size: 24 } }],
    [{ pencil: { wpm: 100 } }],
    [{ pencil: { wpm: 600 } }],
    [{ readAloud: { rate: 0.75 } }],
    [{ readAloud: { rate: 3 } }],
    [{ readAloud: { voices: { kokoro: 'x'.repeat(64) } } }],
  ])('accepts the bound %j', (value) => {
    expect(() => parseSettingValue('reader', value)).not.toThrow();
  });

  it.each([
    [{ type: { size: 13 } }],
    [{ type: { size: 25 } }],
    [{ type: { size: 15.5 } }],
    [{ type: { font: 'comic' } }],
    [{ width: 'huge' }],
    [{ pencil: { wpm: 99 } }],
    [{ pencil: { wpm: 620 } }],
    [{ pencil: { wpm: 250 } }],
    [{ highlight: { color: 'red' } }],
    [{ readAloud: { engine: 'piper' } }],
    [{ readAloud: { rate: 1.1 } }],
    [{ readAloud: { voices: { kokoro: 'x'.repeat(65) } } }],
    [{ readAloud: { voices: { piper: 'x' } } }],
    [{ unknown: true }],
    [null],
  ])('rejects %j', (value) => {
    expect(() => parseSettingValue('reader', value)).toThrow();
  });

  it('a stored read defaults a bad field alone and drops an unknown one', () => {
    const read = parseStoredSettingValue('reader', {
      type: { size: 99, font: 'mono' },
      readAloud: { rate: 9, engine: 'kokoro' },
      extra: 1,
    });
    expect(read?.type).toEqual({ font: 'mono', size: 16, leading: 'normal', theme: 'default' });
    expect(read?.readAloud).toMatchObject({ engine: 'kokoro', rate: 1 });
    expect(read).not.toHaveProperty('extra');
  });
});

describe('ai setting', () => {
  const selection = (provider: string, id: string) => ({
    enabled: true,
    features: {
      librarian: { enabled: false, model: null },
      'x-post-title': { enabled: true, model: { provider, id } },
    },
  });
  it('defaults off with no selected model', () => {
    expect(parseSettingValue('ai', SETTINGS_DEFAULTS.ai)).toEqual({
      enabled: false,
      features: {
        librarian: { enabled: false, model: null },
        'x-post-title': { enabled: false, model: null },
      },
    });
  });
  it('parses model ids without a static list and rejects invalid shapes', () => {
    expect(parseSettingValue('ai', selection('anthropic', 'claude-sonnet-5-5'))).toEqual(
      selection('anthropic', 'claude-sonnet-5-5'),
    );
    expect(() => parseSettingValue('ai', selection('gateway', ''))).toThrow();
    expect(() => parseSettingValue('ai', selection('unknown', 'model'))).toThrow();
  });
  it('converts legacy booleans and the global selection only on reads', () => {
    const old = {
      enabled: true,
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      features: { 'x-post-title': true, retired: true },
    };
    expect(parseStoredSettingValue('ai', old)).toEqual(selection('anthropic', 'claude-haiku-5-5'));
    expect(() => parseSettingValue('ai', old)).toThrow();
  });
  it('fills missing features off, drops retired features on read and rejects them on write', () => {
    const stored = { enabled: true, features: { retired: { enabled: true, model: null } } };
    expect(parseStoredSettingValue('ai', stored)).toEqual({
      enabled: true,
      features: {
        librarian: { enabled: false, model: null },
        'x-post-title': { enabled: false, model: null },
      },
    });
    expect(() => parseSettingValue('ai', stored)).toThrow();
    expect(parseSettingValue('ai', { enabled: true, features: {} })).toEqual({
      enabled: true,
      features: {
        librarian: { enabled: false, model: null },
        'x-post-title': { enabled: false, model: null },
      },
    });
  });
  it('rejects an explicit null feature instead of filling its default', () => {
    expect(() =>
      parseSettingValue('ai', {
        enabled: true,
        features: { 'x-post-title': null },
      }),
    ).toThrow();
  });
  it.each(['anthropic', 'openai', 'gateway'])(
    'keeps a legacy null selection for %s unselected',
    (provider) => {
      const old = { enabled: true, provider, model: null, features: { 'x-post-title': true } };
      expect(parseStoredSettingValue('ai', old)).toEqual({
        enabled: true,
        features: {
          librarian: { enabled: false, model: null },
          'x-post-title': { enabled: true, model: null },
        },
      });
      expect(() => parseSettingValue('ai', old)).toThrow();
    },
  );
  it('keeps a null legacy provider unselected', () => {
    expect(
      parseStoredSettingValue('ai', {
        enabled: true,
        provider: null,
        model: null,
        features: { 'x-post-title': true },
      }),
    ).toEqual({
      enabled: true,
      features: {
        librarian: { enabled: false, model: null },
        'x-post-title': { enabled: true, model: null },
      },
    });
  });
  it('retains ids for stored-list validation in the settings store', () => {
    expect(parseStoredSettingValue('ai', selection('anthropic', 'future-model'))).toEqual(
      selection('anthropic', 'future-model'),
    );
  });
  it('rejects malformed shapes and unknown properties', () => {
    for (const value of [
      'x',
      { enabled: true },
      { ...SETTINGS_DEFAULTS.ai, extra: 1 },
      { enabled: true, features: { 'x-post-title': true } },
    ]) {
      expect(() => parseSettingValue('ai', value)).toThrow();
    }
  });
});

it('defaults old read-aloud settings to relaxed pauses and validates pause writes strictly', () => {
  const old = { readAloud: { engine: 'kokoro', rate: 1.5 } };
  expect(readerSchema.parse(old).readAloud).toMatchObject({
    engine: 'kokoro',
    rate: 1.5,
    pauses: 'relaxed',
  });
  expect(parseStoredSettingValue('reader', old)?.readAloud.pauses).toBe('relaxed');
  for (const pauses of ['short', 'relaxed', 'natural']) {
    expect(readerPatchSchema.parse({ readAloud: { pauses } })).toEqual({ readAloud: { pauses } });
  }
  for (const pauses of ['fast', null, 1]) {
    expect(() => readerSchema.parse({ readAloud: { pauses } })).toThrow();
    expect(() => readerPatchSchema.parse({ readAloud: { pauses } })).toThrow();
  }
});

it('defaults Librarian follow-ups on for existing settings', () => {
  expect(SETTINGS_DEFAULTS.librarianSuggestions).toBe(true);
  expect(parseSettingValue('librarianSuggestions', false)).toBe(false);
});
