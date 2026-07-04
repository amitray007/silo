/**
 * `@silo/api`'s public surface: the app factory (`createApp`) other code —
 * tests, `main.ts`, or a future composition root — builds and drives, plus
 * the link-shaping helpers so a caller can shape a `LinkWithTags` the same
 * way a route does without reaching into `link-json.ts` directly.
 */
export type { ErrorEnvelope } from './app.js';
export { createApp } from './app.js';
export type { LinkJson, SearchResultJson, TrashLinkJson } from './link-json.js';
export { toLinkJson, toSearchResultJson, toTrashLinkJson } from './link-json.js';
