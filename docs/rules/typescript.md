# TypeScript rules

## The strict contract (ENFORCED via `@silo/tsconfig/base.json`)

Every package extends the shared strict base. These are on and non-negotiable:

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `noUnusedLocals`, `noUnusedParameters`
- `isolatedModules`, `verbatimModuleSyntax`, `noEmit`

Do not loosen these per-package. If a rule is genuinely wrong for one file,
suppress at the narrowest scope with a comment explaining why — never widen the
base config.

## Do

- **Prefer `type` imports:** `import type { X } from '...'` for type-only imports
  (`verbatimModuleSyntax` enforces this). Keeps the emit clean.
- **Model illegal states as unrepresentable.** Use discriminated unions over
  optional-flag soups. `noUncheckedIndexedAccess` means array/record access is
  `T | undefined` — handle the `undefined`, don't cast it away.
- **Parse, don't validate.** Untrusted input (HTTP bodies, MCP tool params,
  import files) is parsed through a Zod schema at the boundary, producing a typed
  value the core trusts. Core functions take already-parsed types.
- **Keep functions small.** Biome's cognitive-complexity ceiling (15) is ENFORCED.
  A function that trips it is a signal to decompose, not to raise the limit.

## Don't (forbidden patterns)

- **No `any`.** Use `unknown` + narrowing, or a real type. `as any` to silence the
  checker is a defect, not a fix.
- **No non-null assertions (`!`) to dodge `noUncheckedIndexedAccess`.** Handle the
  `undefined` branch.
- **No default exports** in library packages — named exports only (better for
  refactoring, tree-shaking, and knip's dead-code analysis).
- **No `enum`** — use `as const` object + union type (smaller, no runtime surprises).
- **No cross-package deep imports** — import a package via its public entry
  (`@silo/core`), never `@silo/core/src/internal/...`.

## Style (ENFORCED via Biome)

Single quotes, semicolons, 2-space indent, 100-col width, organized imports.
Don't hand-format — run `pnpm format`.
