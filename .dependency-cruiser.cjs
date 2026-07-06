// Authoritative import-boundary check for the silo monorepo (R7).
//
// Architecture rule: `web`, `api`, and `mcp/server` are thin adapters that may
// depend on `@silo/core` but NOT on each other and NOT on `@silo/db` directly.
// Only `@silo/core` owns data access and may import `@silo/db`.
//
// `@silo/queue` (plan 013) is a shared LIBRARY, not an adapter — like
// `@silo/db`, it's a bit of shared infrastructure both `@silo/api` (the
// enrichment enqueue producer) and `@silo/worker` (producer + consumer) may
// import directly, without that making api/worker depend on EACH OTHER.
// `@silo/queue` itself may only import `@silo/core` (+ pg-boss, a plain
// library) — never any adapter/worker/app, so the dependency direction stays
// adapter/worker -> queue -> core, never the reverse.
//
// dependency-cruiser resolves the real module graph (following workspace:*
// symlinks and relative imports), so a violation is a build failure rather than
// a convention — catching cases Biome's specifier-only noRestrictedImports cannot.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'adapters-no-db',
      comment:
        'Adapters (web/api/mcp) and the composition root (app) must not import @silo/db directly; ' +
        'only @silo/core owns data access. Carve-out: *.test.ts files, and any file under a ' +
        'test-support/ directory, MAY import @silo/db (e.g. the disposable-database test harness, or a ' +
        'shared MCP test-harness module) — integration tests legitimately need real infrastructure, and ' +
        'test code never ships in the runtime. Production code importing @silo/db still fails this rule.',
      severity: 'error',
      from: {
        path: '^packages/(web|api|mcp|app)/',
        pathNot: ['\\.test\\.ts$', '(^|/)test-support/'],
      },
      to: { path: '^packages/db/' },
    },
    // Adapters (web/api/mcp) and the worker service may not import each other,
    // nor the composition root (`@silo/app`). Shared behavior belongs in
    // `@silo/core`. Only `@silo/app` (the composition root — see below) is
    // allowed to import multiple of these to wire a runnable process; the
    // direction is always app -> {adapter,service} -> core, never the reverse
    // and never adapter <-> adapter.
    {
      name: 'web-no-sibling-adapters',
      comment:
        'Adapters/worker must not depend on each other or on @silo/app; share code through @silo/core.',
      severity: 'error',
      from: { path: '^packages/web/' },
      to: { path: '^packages/(api|mcp|worker|app)/' },
    },
    {
      name: 'api-no-sibling-adapters',
      comment:
        'Adapters/worker must not depend on each other or on @silo/app; share code through @silo/core.',
      severity: 'error',
      from: { path: '^packages/api/' },
      to: { path: '^packages/(web|mcp|worker|app)/' },
    },
    {
      name: 'mcp-no-sibling-adapters',
      comment:
        'Adapters/worker must not depend on each other or on @silo/app; share code through @silo/core.',
      severity: 'error',
      from: { path: '^packages/mcp/' },
      to: { path: '^packages/(web|api|worker|app)/' },
    },
    {
      name: 'worker-no-sibling-adapters',
      comment:
        'The worker is a service on the adapter side (it injects into core via the enqueue seam); ' +
        'like the adapters, it must not import them or @silo/app — only @silo/core (+ its own libs, ' +
        'including the shared @silo/queue library).',
      severity: 'error',
      from: { path: '^packages/worker/' },
      to: { path: '^packages/(web|api|mcp|app)/' },
    },
    {
      name: 'queue-no-adapters',
      comment:
        '@silo/queue (plan 013) is a shared LIBRARY like @silo/db, not an adapter — it may only ' +
        'import @silo/core (+ plain libraries like pg-boss/drizzle-orm). It must never import any ' +
        'adapter, the worker, or the @silo/app composition root, or the dependency direction ' +
        '(adapter/worker -> queue -> core) would invert.',
      severity: 'error',
      from: { path: '^packages/queue/' },
      to: { path: '^packages/(web|api|mcp|worker|app)/' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies are forbidden.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    includeOnly: '^packages/',
  },
};
