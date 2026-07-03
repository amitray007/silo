import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { links } from './links.js';
import { tags } from './tags.js';

/** Many-to-many join: one link holds many tags (plan R3). */
export const linkTags = pgTable(
  'link_tags',
  {
    linkId: uuid('link_id')
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.linkId, table.tagId] }),
    // The composite PK covers link_id-leading probes ("tags of a link"). The
    // reverse traversal ("links with a tag" — U4's list-by-tag) needs a
    // tag_id-leading index; every m2m join table needs this second index.
    index('link_tags_tag_id_idx').on(table.tagId),
  ],
);
