import { describe, expect, it } from 'vitest';
import { normalizePluginsValue, parseSettingValue, SETTINGS_DEFAULTS } from './schema.js';

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
