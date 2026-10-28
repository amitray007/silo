/**
 * The AI feature registry (AI foundation). Core owns the list because Settings
 * validates against it and the UI renders from it; the worker owns each
 * feature's behavior (prompt, schema, post-processing). Empty in this slice:
 * the first feature registers itself in the next one.
 *
 * `plugin` places the feature's toggle in that plugin's section on the Plugins
 * tab; a feature with no plugin shows on the AI tab.
 */

export type AiPluginKind = 'hacker_news' | 'github' | 'youtube' | 'twitter';

export type AiFeatureDef = {
  id: string;
  label: string;
  description: string;
  plugin?: AiPluginKind;
};

export const AI_FEATURES = [] as const satisfies readonly AiFeatureDef[];

/** The registered feature IDs. `never` while the registry is empty. */
export type AiFeatureId = (typeof AI_FEATURES)[number]['id'];

/** Fixed error codes. A provider's own error text never leaves the worker. */
export const AI_ERROR_CODES = [
  'invalid_key',
  'no_access',
  'model_not_found',
  'rate_limited',
  'timeout',
  'network',
  'provider_error',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
