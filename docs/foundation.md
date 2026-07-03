# Silo — Foundation checklist ("core is ready")

No **feature** increment is built until every item below is checked (Build philosophy, binding). The foundation itself is built as small increments, smallest-case-first. Edit this list as the core's real shape becomes clear.

> **Product-first note (2026-07-03):** technical foundation items are intentionally left blank right now. The user has directed that product decisions come first — what silo *is* — before any stack, tooling, or infra is chosen. The three default engineering items below stay as placeholders and will be filled in only after the product shape is locked in brainstorm.

## Product foundation (decide first — no stack talk)
- [x] The core capture → find-later loop is defined — paste link → rich metadata + full text → trusted list → tags/notes → search. (2026-07-03, scope map rev 6)
- [x] Which sources get *first-class* treatment is decided — HN + Twitter via a plugin system built together with its first plugins; "first-class" = richer card from source-aware capture. "Just a link" is the universal floor.
- [x] The read-later queue model is defined — **there isn't one.** Tags carry toread/done; queue cut deliberately.
- [ ] The "better-than-a-list" viewing UI is defined at a product level (what makes it good — not how it's built) ← **design phase, in progress**
- [x] The MCP surface is defined at a product level — agent can add a link, list/filter/search items, read an item's details + notes; same operations the human UI uses. (Build staged as the immediate second increment.)
- [x] What silo deliberately does NOT do is written down — anti-scope in `product/scope.html`: no AI inside, not a file store, not a content archive, not every-site understanding, not harbor's everything-store, not multi-user.

## Engineering foundation (fill in AFTER product shape is locked)
- [x] Guardrails: `docs/rules/` per language/stack + Claude agents/skills/hooks that enforce them — (2026-07-04, increment 1: `docs/rules/` + lefthook + `.claude/` hooks + CI)
- [x] Data architecture sketched (models, ownership, migrations, rollout/versioning path) — (2026-07-04, increment 2: `packages/db` schema (links/tags/link_tags + source_data JSONB + generated tsvector) + drizzle-kit migrations + `packages/core` operations (dedup/merge/search/trash/restore/purge); MCP-answerable, pgvector-ready. All units reviewed + QA'd vs real Postgres.)
- [x] Tooling chosen + recorded: production libs, linter + type-checker + formatter, a bug-finding/code-quality tool — (2026-07-04, increment 1: TS+Postgres stack, pnpm+Turborepo, Biome, Vitest, tsc, jscpd, knip, dependency-cruiser; recorded in `docs/brainstorms/2026-07-03-engineering-foundation-requirements.md` + `docs/rules/`)
