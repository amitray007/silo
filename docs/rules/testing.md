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
