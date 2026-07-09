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
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: false, hover: false },
      youtube: { enabled: true, hover: true },
    });
  });

  it('a source already in the new shape passes through untouched', () => {
    const value = {
      hacker_news: { enabled: true, inline: false, hover: true },
      github: { enabled: false, hover: false },
      youtube: { enabled: true, hover: false },
    };
    expect(normalizePluginsValue(value)).toEqual(value);
  });

  it('a mix of legacy booleans and new-shape objects normalizes each source independently', () => {
    expect(
      normalizePluginsValue({
        hacker_news: true,
        github: { enabled: false, hover: true },
        youtube: false,
      }),
    ).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: false, hover: true },
      youtube: { enabled: false, hover: false },
    });
  });

  it('a missing source key falls back to that source default, independent of its siblings', () => {
    expect(normalizePluginsValue({ github: true })).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true },
      youtube: SETTINGS_DEFAULTS.plugins.youtube,
    });
  });

  it('a partial/garbage object for one source falls back to that source default without affecting others', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: true }, // missing inline/hover — partial
        github: true,
        youtube: { enabled: 'yes', hover: true }, // wrong types — garbage
      }),
    ).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true },
      youtube: SETTINGS_DEFAULTS.plugins.youtube,
    });
  });

  it('an extra unknown field on a source object is treated as garbage and falls back to default', () => {
    expect(
      normalizePluginsValue({
        hacker_news: { enabled: true, inline: true, hover: true, extra: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
      }),
    ).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
    });
  });

  it('completely missing/garbage top-level value is returned unchanged (parseSettingValue then falls back to the whole-key default)', () => {
    expect(normalizePluginsValue(undefined)).toBeUndefined();
    expect(normalizePluginsValue(null)).toBeNull();
    expect(normalizePluginsValue('not-an-object')).toBe('not-an-object');
  });
});

describe('plugins schema validation (via parseSettingValue)', () => {
  it('accepts the new nested per-feature shape', () => {
    const value = {
      hacker_news: { enabled: true, inline: false, hover: true },
      github: { enabled: false, hover: false },
      youtube: { enabled: true, hover: true },
    };
    expect(parseSettingValue('plugins', value)).toEqual(value);
  });

  it('a stray field on a per-source object is treated as an unrecognized/garbage shape and that source falls back to its default (does not throw — the migration normalizer is lenient per-source by design)', () => {
    expect(
      parseSettingValue('plugins', {
        hacker_news: { enabled: true, inline: true, hover: true, evil: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
      }),
    ).toEqual({
      hacker_news: SETTINGS_DEFAULTS.plugins.hacker_news,
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
    });
  });

  it('rejects a stray top-level plugin key (.strict())', () => {
    expect(() =>
      parseSettingValue('plugins', {
        hacker_news: { enabled: true, inline: true, hover: true },
        github: { enabled: true, hover: true },
        youtube: { enabled: true, hover: true },
        evil: { enabled: true },
      }),
    ).toThrow();
  });

  it('a legacy boolean blob parses successfully via the read-time migration', () => {
    expect(
      parseSettingValue('plugins', { hacker_news: true, github: false, youtube: true }),
    ).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: false, hover: false },
      youtube: { enabled: true, hover: true },
    });
  });

  it('SETTINGS_DEFAULTS.plugins is all-true (every field on, matching pre-026 enabled-by-default)', () => {
    expect(SETTINGS_DEFAULTS.plugins).toEqual({
      hacker_news: { enabled: true, inline: true, hover: true },
      github: { enabled: true, hover: true },
      youtube: { enabled: true, hover: true },
    });
  });
});
