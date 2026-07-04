// Authoritative import-boundary check for the silo monorepo (R7).
//
// Architecture rule: `web`, `api`, and `mcp/server` are thin adapters that may
// depend on `@silo/core` but NOT on each other and NOT on `@silo/db` directly.
// Only `@silo/core` owns data access and may import `@silo/db`.
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
        'Adapters (web/api/mcp) must not import @silo/db directly; only @silo/core owns data access. ' +
        'Carve-out: *.test.ts files, and any file under a test-support/ directory, MAY import @silo/db ' +
        '(e.g. the disposable-database test harness, or a shared MCP test-harness module) — integration ' +
        'tests legitimately need real infrastructure, and test code never ships in the adapter runtime. ' +
        'Production adapter code importing @silo/db still fails this rule.',
      severity: 'error',
      from: {
        path: '^packages/(web|api|mcp)/',
        pathNot: ['\\.test\\.ts$', '(^|/)test-support/'],
      },
      to: { path: '^packages/db/' },
    },
    {
      name: 'web-no-sibling-adapters',
      comment: 'Adapter packages must not depend on each other; share code through @silo/core.',
      severity: 'error',
      from: { path: '^packages/web/' },
      to: { path: '^packages/(api|mcp)/' },
    },
    {
      name: 'api-no-sibling-adapters',
      comment: 'Adapter packages must not depend on each other; share code through @silo/core.',
      severity: 'error',
      from: { path: '^packages/api/' },
      to: { path: '^packages/(web|mcp)/' },
    },
    {
      name: 'mcp-no-sibling-adapters',
      comment: 'Adapter packages must not depend on each other; share code through @silo/core.',
      severity: 'error',
      from: { path: '^packages/mcp/' },
      to: { path: '^packages/(web|api)/' },
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
