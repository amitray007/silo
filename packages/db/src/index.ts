export type { Database } from './client.js';
export { db, pool } from './client.js';
export {
  accessTokens,
  aiProviders,
  captureStatus,
  links,
  linkTags,
  oauthClients,
  oauthCodes,
  settings,
  tags,
} from './schema/index.js';
export { tsvector } from './types.js';
