## What & why

What does this change and why? Link any related issue.

## Type

<!-- PR title must be a conventional commit: feat / fix / docs / refactor / perf / test / chore / build / ci -->

## Checklist

- [ ] PR title is a conventional commit (`type: summary`)
- [ ] `pnpm turbo run check-types test` passes
- [ ] `pnpm quality` passes (Biome, boundaries, jscpd, knip)
- [ ] Follows [`docs/rules/`](../docs/rules/README.md) (incl. the core/adapter boundary)
- [ ] Feature-bearing changes include colocated tests
- [ ] Stayed within scope (no parked / anti-scope features)
