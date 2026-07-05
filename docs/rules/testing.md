# Testing rules (Vitest)

## Do

- **Colocate tests** next to source: `src/foo.ts` → `src/foo.test.ts`.
- **Test behavior, not implementation.** Assert on observable outcomes (return
  values, persisted state, emitted results), not on internal call sequences.
- **Cover the real edges** for each unit: happy path, boundary/empty/undefined
  inputs (remember `noUncheckedIndexedAccess`), and failure paths (invalid input,
  downstream failure).
- **Integration where mocks can't prove it.** Cross-package behavior (an adapter
  calling `core`, `core` hitting `db`) gets a real integration test, not a mock
  that assumes the wiring works.
- **Every feature-bearing unit ships with tests** in the same commit. The gate
  runs `turbo run test`; `main` stays green.

## Don't

- No tests coupled to private internals that break on harmless refactors.
- No assertion-free tests (calling a function and not asserting proves nothing).
- No skipped/`.only` tests committed — the gate should run everything.

## Running

- `pnpm turbo run test` — whole workspace, cached (the gate).
- `pnpm --filter @silo/core test` — one package.
- Coverage is a separate root job (`vitest run --coverage`), not per-package.

## Integration tests + CI

- Integration suites need a real Postgres; they `describe.skip` when it's
  unreachable so local dev without a DB still passes.
- **CI must not silently skip them.** In CI, `CI_REQUIRE_DB=1` makes an
  unreachable DB a hard failure (not a skip), and the workflow provides a
  `pgvector/pgvector:pg18` service. A green build with skipped integration
  tests is the failure mode to prevent — always confirm CI *ran* the tests,
  not just that it went green.
- **Turbo env gotcha:** `turbo run test` sandboxes task env and strips any
  var not declared in the `test` task's `passThroughEnv`. DB env vars
  (`DATABASE_URL`, `TEST_DATABASE_URL`, `CI_REQUIRE_DB`) are declared there —
  a new env var the tests read at runtime must be added to `passThroughEnv`
  or it won't reach the test process in CI.
- **jscpd does NOT scan test files** (`.jscpd.json` ignores `**/*.test.{ts,tsx}`).
  Test files legitimately share setup boilerplate — mock-`fetch` stubs, a
  `render` helper, `QueryClient`/`MemoryRouter` wrappers, MCP tool-test
  scaffolding — and forcing that DRY produces worse, less-readable tests (a test
  should be legible in isolation). The duplication gate guards PRODUCTION `src`
  only, where a clone signals a missing abstraction. Don't contort a test to
  dodge jscpd; if you're tempted to, the file's probably excluded already.
