export type { Database } from './client.js';
export { db, pool } from './client.js';
export {
  accessTokens,
  aiProviders,
  captureStatus,
  feedEntries,
  feeds,
  HIGHLIGHT_COLORS,
  type HighlightColor,
  highlights,
  linkReaderPrefs,
  links,
  linkTags,
  oauthClients,
  oauthCodes,
  readingPositions,
  settings,
  tags,
} from './schema/index.js';
export { librarianChats, librarianMessages } from './schema/librarian.js';
export { pageSnapshots } from './schema/page-snapshots.js';
export { tsvector } from './types.js';
