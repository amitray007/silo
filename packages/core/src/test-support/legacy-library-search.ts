// Frozen pre-Unit-B query for real-Postgres equivalence checks.
import { db, links } from '@silo/db';
import { asc, desc, sql } from 'drizzle-orm';
import {
  decodeSearchCursor,
  effectiveLimit,
  encodeSearchCursor,
  hydrateTags,
  type LinkSummary,
  type LinkSummaryWithTags,
  listColumns,
  type PageParams,
} from '../links/pagination.js';

export function sanitizeQuery(query: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching C0 controls to strip them (see doc comment).
  return query.replaceAll(/[\u0000-\u001F]/g, '');
}

export function buildPrefixTsQuery(query: string): string | undefined {
  const tokens = query.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return undefined;

  const escaped = tokens.map(
    (token) => `'${token.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`,
  );
  const lastIndex = escaped.length - 1;
  const withPrefix = escaped.map((lexeme, i) => (i === lastIndex ? `${lexeme}:*` : lexeme));
  return withPrefix.join(' & ');
}

const trigramText = sql`(coalesce(${links.title}, '') || ' ' || coalesce(${links.description}, '') || ' ' || regexp_replace(left(split_part(coalesce(${links.canonicalUrl}, ''), '#', 1), 4000), '[^[:alnum:]]+', ' ', 'g') || ' ' || coalesce(${links.notes}, ''))`;

export function escapeIlikeNeedle(query: string): string {
  const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return `%${escaped}%`;
}

export function buildSubstringMatch(
  query: string,
): { match: SqlFragment; similarityRank: SqlNumberFragment } | undefined {
  const trimmed = query.trim();
  if (trimmed.length === 0) return undefined;

  const needle = escapeIlikeNeedle(trimmed);
  const match = sql`${trigramText} ILIKE ${needle} ESCAPE '\\'`;
  const similarityRank = sql<number>`similarity(${trigramText}, ${trimmed})`;
  return { match, similarityRank };
}
type SqlFragment = ReturnType<typeof sql>;
type SqlNumberFragment = ReturnType<typeof sql<number>>;
type SqlTextOrNullFragment = ReturnType<typeof sql<string | null>>;

type FtsSide = {
  tsQuery: SqlFragment;
  match: SqlFragment;
  combinedRank: SqlNumberFragment;
};

type SubstringSide = {
  match: SqlFragment;
  similarityRank: SqlNumberFragment;
};

export type SearchRankedPage = {
  results: (Omit<LinkSummaryWithTags, 'extractedText'> & {
    rank: number;
    snippet: string | null;
  })[];
  nextCursor?: string;
};

export type UnionSearchOptions = {
  extraConditions?: SqlFragment[];

  sort?: 'relevance' | 'newest' | 'oldest';

  snippetFor?: (ftsTsQuery: SqlFragment) => SqlTextOrNullFragment;

  ftsOnly?: boolean;
};

export async function runLegacyUnionSearch(
  basePredicate: SqlFragment,
  tagVector: SqlFragment,
  query: string,
  scopeCondition: SqlFragment | undefined,
  page: PageParams,
  options: UnionSearchOptions = {},
): Promise<SearchRankedPage> {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor !== undefined ? decodeSearchCursor(page.cursor) : undefined;
  const offset = cursor?.offset ?? 0;

  const sanitized = sanitizeQuery(query);
  const ftsQueryText = buildPrefixTsQuery(sanitized);
  const substring = options.ftsOnly ? undefined : buildSubstringMatch(sanitized);

  if (ftsQueryText === undefined && substring === undefined) {
    return { results: [] };
  }
  const fts =
    ftsQueryText === undefined
      ? undefined
      : (() => {
          const tsQuery = sql`to_tsquery('english', ${ftsQueryText})`;
          const titleRank = sql`ts_rank(${links.searchVector}, ${tsQuery})`;
          const tagRank = sql`ts_rank(${tagVector}, ${tsQuery})`;
          return {
            tsQuery,
            match: sql`(${links.searchVector} @@ ${tsQuery} OR ${tagVector} @@ ${tsQuery})`,
            combinedRank: sql<number>`${titleRank} + ${tagRank}`,
          };
        })();

  const matchDisjuncts: SqlFragment[] = [];
  if (fts) matchDisjuncts.push(fts.match);
  if (substring) matchDisjuncts.push(substring.match);
  const unionMatch = sql.join(
    matchDisjuncts.map((d) => sql`(${d})`),
    sql` OR `,
  );
  const ftsMatchedFlag = fts ? sql`(${fts.match})` : sql`false`;
  const combinedRankTerm = fts ? fts.combinedRank : sql`0::float8`;
  const similarityTerm = substring ? substring.similarityRank : sql`0::float8`;
  const rank = resolvePerRowRank(fts, substring);
  const snippet = resolveSnippet(fts, substring, options.snippetFor);

  const orderBy = resolveOrderBy(options.sort, ftsMatchedFlag, combinedRankTerm, similarityTerm);

  const rows = await db
    .select({ link: listColumns, rank, snippet })
    .from(links)
    .where(andAll(basePredicate, unionMatch, scopeCondition, ...(options.extraConditions ?? [])))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .offset(offset);

  return toPage(rows, limit, offset);
}

function resolvePerRowRank(
  fts: FtsSide | undefined,
  substring: SubstringSide | undefined,
): SqlNumberFragment {
  if (fts && substring) {
    return sql<number>`case when (${fts.match}) then (${fts.combinedRank}) else (${substring.similarityRank}) end`;
  }
  if (fts) return fts.combinedRank;
  return substring?.similarityRank ?? sql<number>`0`;
}

function resolveSnippet(
  fts: FtsSide | undefined,
  substring: SubstringSide | undefined,
  snippetFor: ((ftsTsQuery: SqlFragment) => SqlTextOrNullFragment) | undefined,
): SqlTextOrNullFragment {
  if (!(fts && snippetFor)) return sql<string | null>`null`;
  const headline = snippetFor(fts.tsQuery);
  if (!substring) return headline;
  return sql<string | null>`case when (${fts.match}) then (${headline}) else null end`;
}

function resolveOrderBy(
  sort: 'relevance' | 'newest' | 'oldest' | undefined,
  ftsMatchedFlag: SqlFragment,
  combinedRankTerm: SqlFragment,
  similarityTerm: SqlFragment,
): SqlFragment[] {
  if (sort === 'newest') return [desc(links.createdAt), asc(links.id)];
  if (sort === 'oldest') return [asc(links.createdAt), asc(links.id)];
  return [desc(ftsMatchedFlag), desc(combinedRankTerm), desc(similarityTerm), asc(links.id)];
}

function andAll(base: SqlFragment, ...rest: ReadonlyArray<SqlFragment | undefined>): SqlFragment {
  const defined = rest.filter((c): c is SqlFragment => c !== undefined);
  if (defined.length === 0) return base;
  return sql`(${base}) AND ${sql.join(
    defined.map((c) => sql`(${c})`),
    sql` AND `,
  )}`;
}

async function toPage(
  rows: { link: LinkSummary; rank: number; snippet: string | null }[],
  limit: number,
  offset: number,
): Promise<SearchRankedPage> {
  const hasMore = rows.length > limit;
  const page_ = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeSearchCursor(offset + limit) : undefined;

  const hydrated = await hydrateTags(
    db,
    page_.map((row) => row.link),
  );
  const results = hydrated.map((link, i) => {
    const { extractedText, ...rest } = link;
    return { ...rest, rank: page_[i]?.rank ?? 0, snippet: page_[i]?.snippet ?? null };
  });
  return nextCursor === undefined ? { results } : { results, nextCursor };
}
