export const name = '@silo/core';

export type { CanonicalizeResult } from './links/canonicalize.js';
export { canonicalize } from './links/canonicalize.js';
export type {
  CreateLinkInput,
  EditLinkInput,
  Link,
  ListFilter,
  RestoreResult,
  SearchResult,
} from './links/links.js';
export {
  addTag,
  createLink,
  editLink,
  findByCanonicalUrl,
  getById,
  list,
  removeTag,
  restore,
  search,
  softDelete,
} from './links/links.js';
export type { SourceData } from './links/source-data.js';
export { sourceDataSchema } from './links/source-data.js';
