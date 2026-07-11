/**
 * Curated, on-brand seed dataset for silo's README / marketing screenshots.
 *
 * Every URL here was chosen to (a) be real and stable, (b) match silo's calm,
 * local-first, agent-native design vibe, and (c) have a strong cover image so
 * the hover preview looks great. Links are ingested through the REAL
 * `POST /api/ingest` endpoint (see `seed.ts`), so silo's own enrichment worker
 * fetches the live metadata + og:image exactly as production does.
 *
 * Marks (see docs/design/tokens.md — "the four marks"):
 *   ¶  note            → `note`
 *   ◆  added-by-claude → `addedByClaude: true` (SQL backfill; ingest is always user-origin)
 *   ◌  incomplete      → `incomplete: true`     (SQL backfill AFTER enrichment settles)
 * "silence means complete": most rows carry NO mark. Only a few notes, a couple
 * of ◆, a couple of ◌ — the healthy majority stays quiet.
 *
 * Date buckets drive the day-grouped list view.
 */

export type Bucket = 'today' | 'yesterday' | 'this_week' | 'earlier';

/** Minimal twitter sourceData (see packages/core/src/links/source-data.ts). */
export interface TwitterSourceData {
  kind: 'twitter';
  text: string;
  authorHandle: string;
  authorName: string;
  authorAvatarUrl?: string;
  likes: number;
  replies: number;
}

export interface SeedLink {
  url: string;
  /** Only set for X posts (ingest needs sourceKind:'twitter' + sourceData). */
  sourceKind?: 'twitter';
  tags: string[];
  note?: string;
  addedByClaude?: boolean;
  incomplete?: boolean;
  bucket: Bucket;
  twitter?: TwitterSourceData;
}

export const SEED_LINKS: SeedLink[] = [
  // ── Today ──────────────────────────────────────────────────────────────
  {
    url: 'https://www.inkandswitch.com/local-first/',
    tags: ['local-first', 'essays'],
    note: 'the seven ideals — silo is trying to live in #4 and #7',
    bucket: 'today',
  },
  {
    url: 'https://modelcontextprotocol.io/introduction',
    tags: ['mcp', 'ai'],
    bucket: 'today',
  },
  {
    url: 'https://x.com/rauchg/status/1866923863189360811',
    sourceKind: 'twitter',
    tags: ['design', 'product'],
    bucket: 'today',
    twitter: {
      kind: 'twitter',
      text: 'This is a top design principle of mine: the best interface is the one that disappears. Get out of the way.',
      authorHandle: 'rauchg',
      authorName: 'Guillermo Rauch',
      likes: 4200,
      replies: 88,
    },
  },
  {
    url: 'https://www.sqlite.org/appfileformat.html',
    tags: ['local-first', 'product'],
    note: 'the case for a file that IS the app — the substrate argument',
    bucket: 'today',
  },

  // ── Yesterday ──────────────────────────────────────────────────────────
  {
    url: 'https://ciechanow.ski/gears/',
    tags: ['design', 'essays'],
    note: 'gold standard for expl-through-interaction',
    bucket: 'yesterday',
  },
  {
    url: 'https://github.com/modelcontextprotocol/servers',
    tags: ['mcp', 'ai'],
    addedByClaude: true,
    bucket: 'yesterday',
  },
  {
    url: 'https://linear.app/method',
    tags: ['product', 'design'],
    bucket: 'yesterday',
  },
  {
    url: 'https://x.com/svpino/status/1898398856926416977',
    sourceKind: 'twitter',
    tags: ['mcp', 'ai'],
    bucket: 'yesterday',
    twitter: {
      kind: 'twitter',
      text: 'The Model Context Protocol (MCP) is not just "another API lookalike." If you think these two ideas are the same, you still don\'t get it. Let\'s start with a traditional API...',
      authorHandle: 'svpino',
      authorName: 'Santiago',
      likes: 3100,
      replies: 142,
    },
  },

  // ── This week ──────────────────────────────────────────────────────────
  {
    url: 'https://maggieappleton.com/garden-history',
    tags: ['essays', 'design'],
    note: 'digital gardens → the shape of a personal store',
    bucket: 'this_week',
  },
  {
    url: 'https://overreacted.io/the-two-reacts/',
    tags: ['essays'],
    bucket: 'this_week',
  },
  {
    url: 'https://www.anthropic.com/news/model-context-protocol',
    tags: ['mcp', 'ai'],
    addedByClaude: true,
    bucket: 'this_week',
  },
  {
    url: 'https://simonwillison.net/2024/Dec/31/llms-in-2024/',
    tags: ['ai', 'essays'],
    bucket: 'this_week',
  },
  {
    url: 'https://www.youtube.com/watch?v=fPnwBITSmgU',
    tags: ['product', 'design'],
    incomplete: true,
    bucket: 'this_week',
  },
  {
    url: 'https://github.com/anthropics/anthropic-sdk-typescript',
    tags: ['ai', 'mcp'],
    bucket: 'this_week',
  },
  {
    url: 'https://x.com/rauchg/status/1926188308280864959',
    sourceKind: 'twitter',
    tags: ['design'],
    bucket: 'this_week',
    twitter: {
      kind: 'twitter',
      text: 'Good design is a signal that you care. It tells the user: someone thought about this moment, about you, before you ever got here.',
      authorHandle: 'rauchg',
      authorName: 'Guillermo Rauch',
      likes: 5600,
      replies: 120,
    },
  },

  // ── Earlier ────────────────────────────────────────────────────────────
  {
    url: 'https://www.inkandswitch.com/',
    tags: ['local-first'],
    bucket: 'earlier',
  },
  {
    url: 'https://basecamp.com/gettingreal',
    tags: ['product', 'essays'],
    note: 'less mass — the anti-scope, before it was cool',
    bucket: 'earlier',
  },
  {
    url: 'https://stripe.com/blog/online-migrations',
    tags: ['essays'],
    incomplete: true,
    bucket: 'earlier',
  },
  {
    url: 'https://every.to/',
    tags: ['essays', 'product'],
    bucket: 'earlier',
  },
  {
    url: 'https://newsletter.pragmaticengineer.com/',
    tags: ['essays', 'product'],
    bucket: 'earlier',
  },
  {
    url: 'https://www.figma.com/blog/',
    tags: ['design', 'product'],
    bucket: 'earlier',
  },
  {
    url: 'https://x.com/alexxubyte/status/1899136943348441564',
    sourceKind: 'twitter',
    tags: ['ai', 'mcp'],
    addedByClaude: true,
    bucket: 'earlier',
    twitter: {
      kind: 'twitter',
      text: 'What is MCP? Why is everyone talking about it? Let’s take a closer look. Model Context Protocol (MCP) is a new system introduced by Anthropic to make AI models more powerful.',
      authorHandle: 'alexxubyte',
      authorName: 'Alex Xu',
      likes: 8900,
      replies: 210,
    },
  },
  {
    url: 'https://news.ycombinator.com/item?id=39615067',
    tags: ['product', 'local-first'],
    bucket: 'earlier',
  },
];
