/**
 * The per-source enrichment dispatcher — the one thing `enrich.ts` calls
 * after the generic `extract()` step (source-data/rich-previews slice, plan
 * 012). Re-runs `detectSource` on the link's own stored `url` to recover the
 * parsed itemId/owner+repo/videoId (the link's persisted `sourceKind` string
 * says WHICH enricher to run; `detectSource` recovers the typed params that
 * classification needs — cheaper and simpler than threading parsed params
 * through the job payload, and always in sync with the url actually stored).
 *
 * Contract (mirrors every enricher below): NEVER throws. A failure anywhere
 * in this module (network, parse, rate-limit, an unsupported/mismatched
 * sourceKind, or a plugin toggled off) resolves to `undefined` — "no source
 * enrichment this pass" — so `enrichLink` can unconditionally fold the
 * result into its `recordEnrichment` call without a try/catch of its own. A
 * best-effort rich-preview enricher must never fail (or even partially
 * degrade) the generic capture (plan R11's resolve-vs-throw contract in
 * `enrich.ts`).
 *
 * The registry (plan 017 — "extract the framework"): `PLUGINS` maps each
 * pluggable `DetectedSource['kind']` to its enricher function. That same
 * `kind` string doubles as the `plugins`-setting key (`schema.ts`'s
 * `hacker_news`/`github`/`youtube`) — one plugin-identifying name, not two
 * fields to keep in sync. `enrichSource` looks the descriptor up by
 * `detected.kind` and runs it — adding a 4th plugin is: write the enricher,
 * add its `SourceData` union variant + `detectSource` case + settings key,
 * then add ONE descriptor here. No switch to edit. Kept deliberately small —
 * this is a registry over 3 uniform functions, not a dynamic-load/lifecycle
 * plugin system (YAGNI; see docs/rules/architecture.md).
 */

import type { SettingsMap, SourceData } from '@silo/core';
import { detectSource, SETTINGS_DEFAULTS } from '@silo/core';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { safeFetch } from '../fetch/safe-fetch.js';
import { enrichGitHub } from './github.js';
import { enrichHackerNews } from './hacker-news.js';
import { enrichYouTube } from './youtube.js';

/** Injectable seam for testing — defaults to the real `safeFetch`. */
export interface EnrichSourceDeps {
  fetchFn: (url: string) => Promise<SafeFetchResult>;
}

const defaultDeps: EnrichSourceDeps = { fetchFn: safeFetch };

/**
 * A pluggable source kind — every `DetectedSource['kind']` except the
 * `'link'` floor, which has no enricher to toggle. Also the `plugins`-setting
 * key that gates this plugin (`schema.ts`'s `hacker_news`/`github`/`youtube`
 * — the SAME string on both sides; there's exactly one plugin-identifying
 * name per plugin, not two to keep in sync).
 */
type PluginKind = Exclude<ReturnType<typeof detectSource>['kind'], 'link'>;

/** One registered plugin: how to run it once dispatched. */
interface PluginDescriptor {
  kind: PluginKind;
  enrich: (
    detected: ReturnType<typeof detectSource>,
    fetchFn: EnrichSourceDeps['fetchFn'],
  ) => Promise<SourceData | undefined>;
}

/**
 * The whole framework: one descriptor per plugin. Adding a 4th plugin is
 * registering one more entry here (after adding its enricher + `SourceData`
 * variant + `detectSource` case + settings key) — no dispatch code to edit.
 */
const PLUGINS: readonly PluginDescriptor[] = [
  {
    kind: 'hacker_news',
    enrich: (detected, fetchFn) => {
      if (detected.kind !== 'hacker_news') throw new Error('registry/detected kind mismatch');
      return enrichHackerNews(detected.itemId, fetchFn);
    },
  },
  {
    kind: 'github',
    enrich: (detected, fetchFn) => {
      if (detected.kind !== 'github') throw new Error('registry/detected kind mismatch');
      // GitHub's API requires a non-empty User-Agent on every request —
      // `fetchFn` (in production, `safeFetch`) already sends a fixed,
      // identifying one on every call (see fetch/safe-fetch.ts's
      // module-level USER_AGENT), which is all GitHub's API actually checks
      // for (presence, not a specific value) — no extra header plumbing
      // needed here.
      return enrichGitHub(detected.owner, detected.repo, fetchFn);
    },
  },
  {
    kind: 'youtube',
    enrich: (detected, fetchFn) => {
      if (detected.kind !== 'youtube') throw new Error('registry/detected kind mismatch');
      return enrichYouTube(detected.videoId, fetchFn);
    },
  },
];

const PLUGINS_BY_KIND: ReadonlyMap<PluginKind, PluginDescriptor> = new Map(
  PLUGINS.map((plugin) => [plugin.kind, plugin]),
);

// Drift guard (mirrors queue.ts's runtime queue-name-drift check, module-load
// assertion + all): the registry's plugin kinds, one-for-one, against the
// settings-schema's OWN plugin keys (`SETTINGS_DEFAULTS.plugins`) — so a
// future plugin registered here without its settings key (or vice versa)
// fails LOUDLY at import time rather than silently half-working.
const REGISTRY_KINDS = new Set(PLUGINS.map((plugin) => plugin.kind));
const SETTINGS_PLUGIN_KEYS = new Set(Object.keys(SETTINGS_DEFAULTS.plugins));
if (
  REGISTRY_KINDS.size !== SETTINGS_PLUGIN_KEYS.size ||
  ![...REGISTRY_KINDS].every((kind) => SETTINGS_PLUGIN_KEYS.has(kind))
) {
  throw new Error(
    `plugin registry/settings-schema drift: registry=[${[...REGISTRY_KINDS].join(', ')}] ` +
      `settings=[${[...SETTINGS_PLUGIN_KEYS].join(', ')}]`,
  );
}

/**
 * Run the matching per-source enricher for `link`'s `sourceKind`/`url`, or
 * resolve `undefined` for `'link'`/an unrecognized kind, a plugin toggled
 * off, or on ANY failure.
 *
 * `enabledPlugins` is the CURRENT `plugins` settings map (read ONCE per
 * enrichment pass by `enrich.ts` — see its own doc comment — and threaded
 * through here rather than read per-source), or `undefined` when the caller
 * couldn't determine it (treated as "no toggles known" — falls through to
 * every plugin being enabled, matching `SETTINGS_DEFAULTS`; the
 * degrade-to-enabled decision itself lives in `enrich.ts`, which is what
 * actually reads the setting and handles a read failure).
 */
export async function enrichSource(
  sourceKind: string,
  url: string,
  deps: EnrichSourceDeps = defaultDeps,
  enabledPlugins?: SettingsMap['plugins'],
): Promise<SourceData | undefined> {
  try {
    const detected = detectSource(url);
    if (detected.kind !== sourceKind) {
      // The stored sourceKind and what the url currently detects as have
      // diverged (e.g. a caller explicitly set a kind detectSource wouldn't
      // derive) — degrade rather than enrich against a mismatched parse.
      return undefined;
    }

    if (detected.kind === 'link') {
      return undefined;
    }

    const plugin = PLUGINS_BY_KIND.get(detected.kind as PluginKind);
    if (!plugin) {
      // An unrecognized/not-yet-pluggable kind (e.g. 'twitter', which has no
      // registered enricher today) — nothing to dispatch to.
      return undefined;
    }

    // Missing map (enabledPlugins undefined) or missing key both mean
    // "unknown toggle state" — default to enabled, matching
    // `SETTINGS_DEFAULTS.plugins` (all true). The gate is the master
    // `.enabled` field only (plan 026 U2) — the per-feature `inline`/`hover`
    // flags are render-time decisions (U4/U5), not worker-fetch gates: we
    // still fetch source data whenever `enabled` is true even if both
    // render flags are off, since a cheap already-fetched read later is
    // preferable to re-fetching if a feature flag flips back on.
    const isEnabled = enabledPlugins?.[plugin.kind]?.enabled ?? true;
    if (!isEnabled) {
      return undefined;
    }

    return await plugin.enrich(detected, deps.fetchFn);
  } catch {
    // Defense in depth: even though every enricher above is itself
    // contracted to never throw, a genuinely unexpected error here (e.g. a
    // future enricher added without that discipline) must still degrade
    // rather than propagate — a rich-preview enrichment failing can never
    // fail the whole capture.
    return undefined;
  }
}
