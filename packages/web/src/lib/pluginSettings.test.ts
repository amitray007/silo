import { describe, expect, it } from 'vitest';
import { type PluginsMap, setPluginField } from './pluginSettings';

/** A full plugins map with every field distinguishable — deliberately not all-true/all-false so a field mix-up shows up as a wrong VALUE, not just a wrong key. */
function basePlugins(): PluginsMap {
  return {
    hacker_news: { enabled: true, inline: true, hover: false },
    github: { enabled: true, hover: false },
    youtube: { enabled: false, hover: true },
    twitter: { enabled: true, inline: false, hover: false },
  };
}

describe('setPluginField', () => {
  it('flips hacker_news.enabled and leaves inline/hover on that source untouched', () => {
    const next = setPluginField(basePlugins(), 'hacker_news', 'enabled', false);
    expect(next).toEqual({
      hacker_news: { enabled: false, inline: true, hover: false },
      github: { enabled: true, hover: false },
      youtube: { enabled: false, hover: true },
      twitter: { enabled: true, inline: false, hover: false },
    });
  });

  it('flips hacker_news.inline and leaves github/youtube/twitter completely untouched', () => {
    const before = basePlugins();
    const next = setPluginField(before, 'hacker_news', 'inline', false);
    expect(next).toEqual({
      hacker_news: { enabled: true, inline: false, hover: false },
      github: { enabled: true, hover: false },
      youtube: { enabled: false, hover: true },
      twitter: { enabled: true, inline: false, hover: false },
    });
    // Untouched sources are passed through by reference, not deep-cloned.
    expect(next.github).toBe(before.github);
    expect(next.youtube).toBe(before.youtube);
    expect(next.twitter).toBe(before.twitter);
  });

  it('flips hacker_news.hover independently of enabled/inline', () => {
    const next = setPluginField(basePlugins(), 'hacker_news', 'hover', true);
    expect(next.hacker_news).toEqual({ enabled: true, inline: true, hover: true });
  });

  it('flips github.enabled and preserves github.hover', () => {
    const next = setPluginField(basePlugins(), 'github', 'enabled', false);
    expect(next.github).toEqual({ enabled: false, hover: false });
  });

  it('flips github.hover and preserves github.enabled', () => {
    const next = setPluginField(basePlugins(), 'github', 'hover', true);
    expect(next.github).toEqual({ enabled: true, hover: true });
  });

  it('flips youtube.enabled and preserves youtube.hover', () => {
    const next = setPluginField(basePlugins(), 'youtube', 'enabled', true);
    expect(next.youtube).toEqual({ enabled: true, hover: true });
  });

  it('flips youtube.hover and preserves youtube.enabled', () => {
    const next = setPluginField(basePlugins(), 'youtube', 'hover', false);
    expect(next.youtube).toEqual({ enabled: false, hover: false });
  });

  it('flips twitter.enabled and preserves twitter.inline/hover', () => {
    const next = setPluginField(basePlugins(), 'twitter', 'enabled', false);
    expect(next.twitter).toEqual({ enabled: false, inline: false, hover: false });
  });

  it('flips twitter.inline and preserves twitter.enabled/hover', () => {
    const next = setPluginField(basePlugins(), 'twitter', 'inline', true);
    expect(next.twitter).toEqual({ enabled: true, inline: true, hover: false });
  });

  it('flips twitter.hover and preserves twitter.enabled/inline', () => {
    const next = setPluginField(basePlugins(), 'twitter', 'hover', true);
    expect(next.twitter).toEqual({ enabled: true, inline: false, hover: true });
  });

  it('re-enabling a disabled source restores its prior inline/hover choices rather than resetting them', () => {
    const disabled = setPluginField(basePlugins(), 'hacker_news', 'enabled', false);
    // inline/hover survived the disable...
    expect(disabled.hacker_news).toEqual({ enabled: false, inline: true, hover: false });
    // ...and re-enabling picks them back up unchanged, not reset to any default.
    const reenabled = setPluginField(disabled, 'hacker_news', 'enabled', true);
    expect(reenabled.hacker_news).toEqual({ enabled: true, inline: true, hover: false });
  });

  it('returns the full four-source object, not a partial patch', () => {
    const next = setPluginField(basePlugins(), 'youtube', 'hover', false);
    expect(Object.keys(next).sort()).toEqual(['github', 'hacker_news', 'twitter', 'youtube']);
  });

  it('does not mutate the input plugins map', () => {
    const before = basePlugins();
    const snapshot = JSON.parse(JSON.stringify(before));
    setPluginField(before, 'hacker_news', 'enabled', false);
    expect(before).toEqual(snapshot);
  });
});
