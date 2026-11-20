/**
 * Curated seed dataset for silo's README screenshots.
 *
 * Every URL is real, live, and has readable text plus a cover image, so the
 * reader and the hover preview look like a real library. Links go through the
 * REAL `POST /api/ingest` endpoint (see `seed.ts`), so silo's own enrichment
 * worker fetches metadata, full text, and source data exactly as production
 * does. No post text or metrics are invented here.
 *
 * Marks (see docs/design/tokens.md, "the four marks"):
 *   ¶  note            -> `note`
 *   ◆  added-by-claude -> `addedByClaude: true` (SQL backfill; ingest is always user-origin)
 * Healthy rows carry no mark, so most entries set neither.
 *
 * Date buckets drive the day-grouped list view.
 */

export type Bucket = 'today' | 'yesterday' | 'this_week' | 'earlier';

export interface SeedLink {
  url: string;
  tags: string[];
  note?: string;
  addedByClaude?: boolean;
  bucket: Bucket;
}

/** The article the reader screenshots open. It also carries the highlights and a chat. */
export const HERO_URL = 'https://www.anthropic.com/engineering/building-effective-agents';

/** Articles the library screenshots open in the reader, keyed by manifest name. */
export const SHOT_URLS = {
  localFirst: 'https://www.inkandswitch.com/essay/local-first/',
  transformer: 'https://jalammar.github.io/illustrated-transformer/',
} as const;

export const SEED_LINKS: SeedLink[] = [
  // ── Today ──────────────────────────────────────────────────────────────
  {
    url: HERO_URL,
    tags: ['agents', 'essays'],
    note: 'start simple; add agent loops only when a workflow cannot do it',
    bucket: 'today',
  },
  {
    url: 'https://www.anthropic.com/engineering/claude-code-best-practices',
    tags: ['agents', 'tools'],
    bucket: 'today',
  },
  {
    url: 'https://simonwillison.net/2024/Dec/31/llms-in-2024/',
    tags: ['llm', 'essays'],
    bucket: 'today',
  },
  {
    url: 'https://ciechanow.ski/mechanical-watch/',
    tags: ['design', 'explorables'],
    note: 'the gold standard for interactive explanations',
    bucket: 'today',
  },

  // ── Yesterday ──────────────────────────────────────────────────────────
  {
    url: 'https://lilianweng.github.io/posts/2023-06-23-agent/',
    tags: ['agents', 'llm'],
    addedByClaude: true,
    bucket: 'yesterday',
  },
  {
    url: 'https://modelcontextprotocol.io/introduction',
    tags: ['mcp', 'agents'],
    bucket: 'yesterday',
  },
  {
    url: 'https://github.com/modelcontextprotocol/servers',
    tags: ['mcp', 'open-source'],
    bucket: 'yesterday',
  },
  {
    url: SHOT_URLS.localFirst,
    tags: ['local-first', 'essays'],
    note: 'the seven ideals; silo lives in #4 and #7',
    bucket: 'yesterday',
  },
  {
    url: 'https://overreacted.io/the-two-reacts/',
    tags: ['frontend', 'essays'],
    bucket: 'yesterday',
  },

  // ── This week ──────────────────────────────────────────────────────────
  {
    url: 'https://www.anthropic.com/news/model-context-protocol',
    tags: ['mcp', 'agents'],
    bucket: 'this_week',
  },
  {
    url: 'https://github.com/anthropics/claude-code',
    tags: ['agents', 'open-source', 'tools'],
    bucket: 'this_week',
  },
  {
    url: 'https://maggieappleton.com/garden-history',
    tags: ['essays', 'design'],
    bucket: 'this_week',
  },
  {
    url: 'https://www.joshwcomeau.com/css/interactive-guide-to-flexbox/',
    tags: ['frontend', 'explorables'],
    bucket: 'this_week',
  },
  {
    url: 'https://paulgraham.com/greatwork.html',
    tags: ['essays'],
    addedByClaude: true,
    bucket: 'this_week',
  },
  {
    url: 'https://ciechanow.ski/gears/',
    tags: ['design', 'explorables'],
    bucket: 'this_week',
  },
  {
    url: 'https://jvns.ca/blog/2024/02/16/popular-git-config-options/',
    tags: ['tools'],
    bucket: 'this_week',
  },

  // ── Earlier ────────────────────────────────────────────────────────────
  {
    url: 'https://karpathy.github.io/2019/04/25/recipe/',
    tags: ['llm', 'essays'],
    bucket: 'earlier',
  },
  {
    url: 'https://www.figma.com/blog/how-figmas-multiplayer-technology-works/',
    tags: ['local-first', 'design'],
    bucket: 'earlier',
  },
  {
    url: 'https://stripe.com/blog/online-migrations',
    tags: ['engineering'],
    note: 'dual-write, backfill, flip reads, then stop writing the old table',
    bucket: 'earlier',
  },
  {
    url: 'https://www.sqlite.org/appfileformat.html',
    tags: ['local-first', 'engineering'],
    bucket: 'earlier',
  },
  {
    url: 'https://github.com/excalidraw/excalidraw',
    tags: ['open-source', 'design', 'tools'],
    bucket: 'earlier',
  },
  {
    url: 'https://linear.app/method',
    tags: ['design', 'essays'],
    bucket: 'earlier',
  },
  {
    url: 'https://basecamp.com/gettingreal',
    tags: ['essays'],
    bucket: 'earlier',
  },
  // ── More reading, so every list and tag fills the screen ───────────────
  {
    url: 'https://www.anthropic.com/engineering/writing-tools-for-agents',
    tags: ['agents', 'mcp'],
    bucket: 'today',
  },
  {
    url: 'https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents',
    tags: ['agents', 'llm'],
    note: 'context is a budget; spend it on what the next step needs',
    bucket: 'today',
  },
  {
    url: 'https://www.anthropic.com/engineering/multi-agent-research-system',
    tags: ['agents', 'research'],
    addedByClaude: true,
    bucket: 'today',
  },
  {
    url: SHOT_URLS.transformer,
    tags: ['llm', 'explorables'],
    bucket: 'today',
  },
  {
    url: 'https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/',
    tags: ['agents', 'security'],
    note: 'private data + untrusted content + a way out = exfiltration',
    bucket: 'today',
  },
  {
    url: 'https://www.anthropic.com/engineering/claude-think-tool',
    tags: ['agents', 'llm'],
    bucket: 'yesterday',
  },
  {
    url: 'https://huyenchip.com/2025/01/07/agents.html',
    tags: ['agents', 'essays'],
    bucket: 'yesterday',
  },
  {
    url: 'https://hamel.dev/blog/posts/evals/',
    tags: ['evals', 'llm'],
    bucket: 'yesterday',
  },
  {
    url: 'https://github.com/microsoft/playwright-mcp',
    tags: ['mcp', 'open-source', 'tools'],
    addedByClaude: true,
    bucket: 'yesterday',
  },
  {
    url: 'https://www.anthropic.com/research/tracing-thoughts-language-model',
    tags: ['llm', 'research'],
    bucket: 'yesterday',
  },
  {
    url: 'https://ciechanow.ski/bicycle/',
    tags: ['explorables', 'design'],
    bucket: 'yesterday',
  },
  {
    url: 'https://eugeneyan.com/writing/llm-patterns/',
    tags: ['llm', 'evals'],
    bucket: 'this_week',
  },
  {
    url: 'https://github.com/openai/codex',
    tags: ['agents', 'open-source', 'tools'],
    bucket: 'this_week',
  },
  {
    url: 'https://lilianweng.github.io/posts/2024-07-07-hallucination/',
    tags: ['llm', 'research'],
    bucket: 'this_week',
  },
  {
    url: 'https://modelcontextprotocol.io/specification/2025-06-18',
    tags: ['mcp'],
    bucket: 'this_week',
  },
  {
    url: 'https://www.figma.com/blog/introducing-figma-mcp-server/',
    tags: ['mcp', 'design'],
    bucket: 'this_week',
  },
  {
    url: 'https://maggieappleton.com/ai-dark-forest',
    tags: ['essays', 'llm'],
    bucket: 'this_week',
  },
  {
    url: 'https://www.joshwcomeau.com/react/server-components/',
    tags: ['frontend', 'explorables'],
    bucket: 'this_week',
  },
  {
    url: 'https://ciechanow.ski/airfoil/',
    tags: ['explorables'],
    bucket: 'this_week',
  },
  {
    url: 'https://martinfowler.com/articles/exploring-gen-ai.html',
    tags: ['agents', 'engineering'],
    bucket: 'this_week',
  },
  {
    url: 'https://karpathy.github.io/2015/05/21/rnn-effectiveness/',
    tags: ['llm', 'research'],
    bucket: 'earlier',
  },
  {
    url: 'https://paulgraham.com/ds.html',
    tags: ['essays'],
    bucket: 'earlier',
  },
  {
    url: 'https://stripe.com/blog/canonical-log-lines',
    tags: ['engineering'],
    bucket: 'earlier',
  },
  {
    url: 'https://brandur.org/idempotency-keys',
    tags: ['engineering'],
    note: 'store the key and the response in one transaction',
    bucket: 'earlier',
  },
  {
    url: 'https://github.com/ollama/ollama',
    tags: ['llm', 'open-source', 'tools'],
    bucket: 'earlier',
  },
  {
    url: 'https://github.com/tldraw/tldraw',
    tags: ['open-source', 'design'],
    bucket: 'earlier',
  },
  {
    url: 'https://react.dev/blog/2024/12/05/react-19',
    tags: ['frontend'],
    bucket: 'earlier',
  },
  {
    url: 'https://tailwindcss.com/blog/tailwindcss-v4',
    tags: ['frontend', 'tools'],
    bucket: 'earlier',
  },
  {
    url: 'https://overreacted.io/a-complete-guide-to-useeffect/',
    tags: ['frontend', 'essays'],
    bucket: 'earlier',
  },
  {
    url: 'https://web.dev/articles/vitals',
    tags: ['frontend', 'engineering'],
    bucket: 'earlier',
  },
  {
    url: 'https://www.inkandswitch.com/upwelling/',
    tags: ['local-first', 'research'],
    bucket: 'earlier',
  },
  {
    url: 'https://danluu.com/look-stupid/',
    tags: ['essays'],
    bucket: 'earlier',
  },
  {
    url: 'https://bun.sh/blog/bun-v1.0',
    tags: ['tools', 'open-source'],
    bucket: 'earlier',
  },
  {
    url: 'https://sre.google/sre-book/embracing-risk/',
    tags: ['engineering'],
    bucket: 'earlier',
  },
  {
    url: 'https://astral.sh/blog/uv',
    tags: ['tools', 'open-source'],
    bucket: 'earlier',
  },
  {
    url: 'https://antirez.com/news/145',
    tags: ['essays', 'engineering'],
    bucket: 'earlier',
  },
  {
    url: 'https://lethain.com/staff-engineer/',
    tags: ['engineering', 'essays'],
    bucket: 'earlier',
  },
];

/**
 * Highlights on the hero article. Each quote is matched in the saved text by
 * the real highlights endpoint. A quote the extractor reworded is skipped.
 */
export interface SeedHighlight {
  quote: string;
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'violet';
  note?: string;
}

export const HERO_HIGHLIGHTS: SeedHighlight[] = [
  {
    quote:
      "Consistently, the most successful implementations weren't using complex frameworks or specialized libraries.",
    color: 'yellow',
  },
  {
    quote:
      'we recommend finding the simplest solution possible, and only increasing complexity when needed',
    color: 'green',
    note: 'the rule for every silo AI feature',
  },
  {
    quote:
      'The basic building block of agentic systems is an LLM enhanced with augmentations such as retrieval, tools, and memory.',
    color: 'blue',
  },
];

/** RSS / Atom feeds, subscribed through the real `POST /api/feeds` endpoint. */
export const SEED_FEEDS: string[] = [
  'https://jvns.ca/atom.xml',
  'https://simonwillison.net/atom/everything/',
  'https://ciechanow.ski/atom.xml',
  'https://overreacted.io/rss.xml',
];

/**
 * Librarian chats, written straight to the database. A screenshot run has no
 * model provider, so these show the chat surface without calling a model.
 * `hero: true` ties the chat to the hero article.
 */
export interface SeedChat {
  title: string;
  hero?: boolean;
  /** Hours before now; orders the sidebar list. */
  ageHours: number;
  messages: { role: 'user' | 'assistant'; text: string }[];
}

export const SEED_CHATS: SeedChat[] = [
  {
    title: 'What is the lethal trifecta?',
    ageHours: 0.5,
    messages: [
      { role: 'user', text: 'Explain the lethal trifecta from my saved Simon Willison post.' },
      {
        role: 'assistant',
        text: 'An agent is at risk when it has all three: access to **private data**, exposure to **untrusted content**, and a way to **send data out**. A prompt injection in the untrusted content can then make the agent leak your data. Remove any one of the three and the attack fails.',
      },
    ],
  },
  {
    title: 'Saved this week',
    ageHours: 3,
    messages: [
      { role: 'user', text: 'What did I save this week?' },
      {
        role: 'assistant',
        text: "Most of this week's saves are about **agents** and **LLM evals**: Hamel Husain on evals, Eugene Yan on LLM patterns, and the Codex repository. You also saved two explorables: Airfoil and the guide to React Server Components.",
      },
    ],
  },
  {
    title: 'Workflows or agents?',
    hero: true,
    ageHours: 1,
    messages: [
      {
        role: 'user',
        text: 'When does this article say to use an agent instead of a workflow?',
      },
      {
        role: 'assistant',
        text: 'It says to start with the simplest thing that works. Use a **workflow** when the task splits cleanly into fixed steps: prompt chaining, routing, or parallel calls give you predictable results.\n\nReach for an **agent** only when you cannot predict the steps in advance and the model must decide what to do next. The article adds a warning: agents trade latency and cost for flexibility, so put guardrails and tests around them.\n\nYour note on this link says the same thing: *start simple; add agent loops only when a workflow cannot do it.*',
      },
    ],
  },
  {
    title: 'Reading list for MCP',
    ageHours: 5,
    messages: [
      { role: 'user', text: 'What have I saved about MCP? Give me an order to read them in.' },
      {
        role: 'assistant',
        text: 'You have four MCP links. Read them in this order:\n\n1. **Introducing the Model Context Protocol**: the announcement and the why.\n2. **What is the Model Context Protocol?**: the concepts: hosts, clients, servers.\n3. **modelcontextprotocol/servers**: reference servers to read real code.\n4. **Building effective agents**: where MCP fits as the augmented LLM building block.',
      },
    ],
  },
  {
    title: 'Best interactive explainers',
    ageHours: 26,
    messages: [
      { role: 'user', text: 'Which of my saved posts are interactive explainers?' },
      {
        role: 'assistant',
        text: 'Three links are tagged **explorables**: Bartosz Ciechanowski on mechanical watches and on gears, and Josh Comeau on Flexbox. All three teach with live diagrams that you drag and adjust.',
      },
    ],
  },
  {
    title: 'Local-first, summarized',
    ageHours: 50,
    messages: [
      { role: 'user', text: 'Summarize my local-first links in three bullets.' },
      {
        role: 'assistant',
        text: '- **Ink & Switch** names seven ideals, such as fast, offline, and long-lived data you own.\n- **SQLite as an application file format** argues that one file can be the whole app.\n- **Figma multiplayer** shows how a central server can still merge edits from many people in real time.',
      },
    ],
  },
];
