# Silo — build reference docs

Silo is an **agent-native personal link store**: feed in web material (links, Twitter/X posts, HN posts, videos) captured with rich metadata + full text, organized by tags + a single note field, searchable, and served over MCP so an external agent (Claude) does all the intelligence. **No AI lives inside silo** — silo is the substrate; the mind sits on top.

These docs were produced in a planning phase and moved here as the reference the build implements against. The **stack is deliberately undecided** — that is the first real decision, made here in the project.

## Where things are

- **`product/scope.html`** — the product scope map: what the first build is, what comes next, and the deliberate anti-scope (open in a browser). The source of truth for *what to build*.
- **`product/future-scope.md`** — parked ideas. Explicitly **not** to be built now (read-later queue, PDF upload, content archival, standalone activity trail, etc.).
- **`foundation.md`** — the "core is ready" checklist. **No feature increment is built until the foundation items are done** (guardrails, data architecture, tooling). Product-foundation items are already resolved; the engineering ones are the first work.
- **`design/tokens.md`** — the "Oat" design system: palette, type (Geist Sans 400/500), the amber-only-as-mark rule, anti-slop rules. Source of truth for *how it looks*.
- **`design/ui-notes.md`** — the UI review punch-list (P0–P3), applied and verified in the captured prototype. Useful implementation notes.
- **`design/app/`** — the captured final UI prototype (`Silo-v2.html` + fonts + runtime + reference PNGs). See `design/app/README.md`. `Silo-v2.html` renders inside Claude Design; the PNGs are the offline reference.

## The build philosophy (carried from planning)

- **Smallest real thing first, then grow by increments** toward an OSS-able endpoint. No v0/v1/phase/MVP vocabulary; no big upfront plan.
- **Foundation before features** (gated by `foundation.md`): guardrails (`docs/rules/` per language + lint/type/test hooks), data architecture, and tooling exist before any feature increment.
- **First slice** = the thinnest end-to-end path: paste a link → fetch metadata + full text → it appears in the list → find it again. Working software at the end of every slice.
- **Commit promptly** the moment a unit of work is complete; stage by explicit path, never `git add -A`.

## First decisions to make here
1. **Stack** (language, framework, storage, how full-text + eventual MCP surface are served).
2. **Guardrails** — `docs/rules/` + enforcement hooks — as the first foundation increment.
3. **Data model** — link, tags (m2m), one note, trash + purge, capture status; designed to be MCP-answerable and to bolt on a mechanical semantic index later.
